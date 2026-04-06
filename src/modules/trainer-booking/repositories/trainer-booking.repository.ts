import { Injectable } from '@nestjs/common';
import {
  Prisma,
  TrainerBookingStatus,
  User,
} from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  TRAINER_BOOKING_BLOCKING_STATUSES,
  TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS,
  TRAINER_BOOKING_PENDING_REVIEW_TTL_MS,
} from '../constants/trainer-booking.constants';
import { TrainerBookingEntity } from '../entities/trainer-booking.entity';
import {
  toTrainerBookingEntity,
} from '../mapper/trainer-booking.mapper';

type TrainerBookingWithRelations = Prisma.TrainerBookingGetPayload<{
  include: {
    member: true;
    trainer: true;
  };
}>;

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TrainerBookingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<TrainerBookingEntity | null> {
    const booking = await this.prisma.trainerBooking.findUnique({
      where: { id },
      include: {
        member: true,
        trainer: true,
      },
    });

    return booking ? toTrainerBookingEntity(booking) : null;
  }

  async findRawById(
    id: string,
    db: DbClient = this.prisma,
  ): Promise<TrainerBookingWithRelations | null> {
    return db.trainerBooking.findUnique({
      where: { id },
      include: {
        member: true,
        trainer: true,
      },
    });
  }

  async listByMemberId(memberId: string): Promise<TrainerBookingEntity[]> {
    const bookings = await this.prisma.trainerBooking.findMany({
      where: { memberId },
      include: {
        member: true,
        trainer: true,
      },
      orderBy: [{ startAt: 'desc' }, { createdAt: 'desc' }],
    });

    return bookings.map(toTrainerBookingEntity);
  }

  async listByTrainerId(trainerId: string): Promise<TrainerBookingEntity[]> {
    const bookings = await this.prisma.trainerBooking.findMany({
      where: { trainerId },
      include: {
        member: true,
        trainer: true,
      },
      orderBy: [{ startAt: 'desc' }, { createdAt: 'desc' }],
    });

    return bookings.map(toTrainerBookingEntity);
  }

  async create(
    data: Prisma.TrainerBookingUncheckedCreateInput,
    db: DbClient = this.prisma,
  ) {
    const booking = await db.trainerBooking.create({
      data,
      include: {
        member: true,
        trainer: true,
      },
    });

    return toTrainerBookingEntity(booking);
  }

  async update(
    id: string,
    data: Prisma.TrainerBookingUncheckedUpdateInput,
    db: DbClient = this.prisma,
  ): Promise<TrainerBookingEntity> {
    const booking = await db.trainerBooking.update({
      where: { id },
      data,
      include: {
        member: true,
        trainer: true,
      },
    });

    return toTrainerBookingEntity(booking);
  }

  async findBlockingOverlapForTrainer(params: {
    trainerId: string;
    startAt: Date;
    endAt: Date;
    excludeBookingId?: string;
  }, db: DbClient = this.prisma) {
    return db.trainerBooking.findFirst({
      where: {
        trainerId: params.trainerId,
        status: { in: this.blockingStatuses() },
        startAt: { lt: params.endAt },
        endAt: { gt: params.startAt },
        ...(params.excludeBookingId
          ? { id: { not: params.excludeBookingId } }
          : {}),
      },
    });
  }

  async findBlockingOverlapForMember(params: {
    memberId: string;
    startAt: Date;
    endAt: Date;
    excludeBookingId?: string;
  }, db: DbClient = this.prisma) {
    return db.trainerBooking.findFirst({
      where: {
        memberId: params.memberId,
        status: { in: this.blockingStatuses() },
        startAt: { lt: params.endAt },
        endAt: { gt: params.startAt },
        ...(params.excludeBookingId
          ? { id: { not: params.excludeBookingId } }
          : {}),
      },
    });
  }

  async listBlockingBookingsForTrainerInRange(params: {
    trainerId: string;
    from: Date;
    to: Date;
  }) {
    return this.prisma.trainerBooking.findMany({
      where: {
        trainerId: params.trainerId,
        status: { in: this.blockingStatuses() },
        startAt: { lt: params.to },
        endAt: { gt: params.from },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async listBlockingBookingsForMemberInRange(params: {
    memberId: string;
    from: Date;
    to: Date;
  }) {
    return this.prisma.trainerBooking.findMany({
      where: {
        memberId: params.memberId,
        status: { in: this.blockingStatuses() },
        startAt: { lt: params.to },
        endAt: { gt: params.from },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async expirePendingReview(now: Date): Promise<number> {
    const result = await this.prisma.trainerBooking.updateMany({
      where: {
        status: TrainerBookingStatus.PENDING_REVIEW,
        OR: [
          {
            createdAt: {
              lte: new Date(now.getTime() - TRAINER_BOOKING_PENDING_REVIEW_TTL_MS),
            },
          },
          { startAt: { lte: now } },
        ],
      },
      data: {
        status: TrainerBookingStatus.EXPIRED,
      },
    });

    return result.count;
  }

  async expirePendingPayment(now: Date): Promise<number> {
    const result = await this.prisma.trainerBooking.updateMany({
      where: {
        status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
        updatedAt: {
          lte: new Date(now.getTime() - TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS),
        },
      },
      data: {
        status: TrainerBookingStatus.EXPIRED,
      },
    });

    return result.count;
  }

  async findTrainerUserById(trainerId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        id: trainerId,
        userRole: {
          some: {
            role: {
              name: 'TRAINER',
            },
          },
        },
      },
    });
  }

  private blockingStatuses(): TrainerBookingStatus[] {
    return TRAINER_BOOKING_BLOCKING_STATUSES;
  }
}
