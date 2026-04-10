import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DayOfWeek,
  ExceptionType,
  NotificationType,
  Prisma,
  TrainerBookingStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  NOTIFICATION_EVENTS,
  NotificationEventPayload,
} from '../../common/events/notification.events';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import {
  TRAINER_BOOKING_DEFAULT_CURRENCY,
  TRAINER_BOOKING_MESSAGE_WINDOW_DAYS,
  TRAINER_BOOKING_REMINDER_LOOKAHEAD_HOURS,
  TRAINER_BOOKING_REMINDER_TITLE,
  TRAINER_BOOKING_SUPPORTED_DURATIONS,
} from './constants/trainer-booking.constants';
import { CreateTrainerBookingDto } from './dto/create-trainer-booking.dto';
import { TrainerBookingActionDto } from './dto/trainer-booking-action.dto';
import {
  TrainerBookingSlotsQueryDto,
  TrainerBookingTrainerQueryDto,
} from './dto/trainer-booking-query.dto';
import { TrainerBookingEntity } from './entities/trainer-booking.entity';
import {
  toTrainerBookingEntity,
  toTrainerPricing,
  toTrainerProfileResponse,
} from './mapper/trainer-booking.mapper';
import { TrainerBookingRepository } from './repositories/trainer-booking.repository';
import {
  addMinutes,
  createUtcDate,
  dayOfWeekToIndex,
  endOfUtcDay,
  isValidDurationMinutes,
  minutesBetween,
  overlaps,
  sameCalendarDay,
  startOfUtcDay,
  subtractTimeRanges,
  TimeRange,
} from './utils/trainer-booking.utils';

type DbClient = Prisma.TransactionClient | PrismaService;

type TrainerProfileRecord = Prisma.UserGetPayload<{
  include: {
    userRole: { include: { role: true } };
    userMembership: { include: { membership: true } };
    trainerAvailabilities: true;
  };
}>;

type ClassScheduleConflictRecord = Prisma.ClassScheduleGetPayload<{
  include: {
    scheduleDays: true;
    scheduleExceptions: true;
  };
}>;

type ClassBookingConflictRecord = Prisma.ClassBookingGetPayload<{
  include: {
    classSchedule: {
      include: {
        scheduleDays: true;
        scheduleExceptions: true;
      };
    };
  };
}>;

export type TrainerMessagingEligibleContact = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

@Injectable()
export class TrainerBookingService {
  private readonly logger = new Logger(TrainerBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainerBookingRepository: TrainerBookingRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async listBookableTrainers(
    query: TrainerBookingTrainerQueryDto,
    currentUser?: RequestUser,
  ) {
    await this.expireStaleBookings();

    const trainers = await this.prisma.user.findMany({
      where: {
        userRole: {
          some: {
            role: {
              name: ERoleName.TRAINER,
            },
          },
        },
        ...(query.specialization
          ? {
              trainerSpecialization: {
                contains: query.specialization,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(query.q
          ? {
              OR: [
                {
                  firstName: {
                    contains: query.q,
                    mode: 'insensitive',
                  },
                },
                {
                  lastName: {
                    contains: query.q,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: query.q,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        userRole: { include: { role: true } },
        userMembership: { include: { membership: true } },
        trainerAvailabilities: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const canBook = currentUser
      ? await this.hasActiveMembership(currentUser.sub)
      : false;
    const memberId = this.getConflictScopedMemberId(currentUser);

    const targetDate = query.date ? startOfUtcDay(query.date) : undefined;
    const result: Array<
      ReturnType<typeof toTrainerProfileResponse>
    > = [];

    for (const trainer of trainers) {
      const pricing = toTrainerPricing(trainer);
      if (!this.matchesPriceFilter(pricing, query)) {
        continue;
      }

      const availabilitySlots = targetDate
        ? await this.getAvailableSlotsForTrainer(
            trainer.id,
            targetDate,
            targetDate,
            memberId,
          )
        : [];

      if (query.availableOnly && targetDate && availabilitySlots.length === 0) {
        continue;
      }

      if (
        query.availableOnly &&
        !targetDate &&
        !trainer.trainerAvailabilities.some((slot) => slot.isAvailable)
      ) {
        continue;
      }

      result.push(
        toTrainerProfileResponse(trainer, {
          pricing,
          availabilitySlots,
          canBook,
        }),
      );
    }

    return result;
  }

  async getTrainerProfile(trainerId: string, currentUserId?: string) {
    await this.expireStaleBookings();

    const trainer = await this.getTrainerProfileOrThrow(trainerId, this.prisma);
    const canBook = currentUserId
      ? await this.hasActiveMembership(currentUserId)
      : false;

    return toTrainerProfileResponse(trainer, {
      pricing: toTrainerPricing(trainer),
      availabilitySlots: [],
      canBook,
    });
  }

  async getTrainerSlots(
    trainerId: string,
    query: TrainerBookingSlotsQueryDto,
    currentUser?: RequestUser,
  ) {
    await this.expireStaleBookings();
    await this.getTrainerProfileOrThrow(trainerId, this.prisma);

    const from = startOfUtcDay(query.from ?? new Date());
    const to = startOfUtcDay(query.to ?? addMinutes(from, 6 * 24 * 60));

    if (to < from) {
      throw new BadRequestException('Slot query range is invalid');
    }

    return this.getAvailableSlotsForTrainer(
      trainerId,
      from,
      to,
      this.getConflictScopedMemberId(currentUser),
    );
  }

  async create(
    memberId: string,
    dto: CreateTrainerBookingDto,
  ): Promise<TrainerBookingEntity> {
    this.validateWindow(dto.startAt, dto.endAt);

    await this.expireStaleBookings();

    if (dto.trainerId === memberId) {
      throw new BadRequestException('Members cannot book themselves as trainer');
    }

    const durationMinutes = minutesBetween(dto.startAt, dto.endAt);
    const createdBooking = await this.runSerializableRetry(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            await this.lockBookingActors(tx, dto.trainerId, memberId);
            await this.ensureActiveMembership(memberId, tx);
            const trainer = await this.getTrainerProfileOrThrow(dto.trainerId, tx);
            await this.ensureNoCrossDomainConflicts(
              tx,
              dto.trainerId,
              memberId,
              dto.startAt,
              dto.endAt,
            );
            return this.trainerBookingRepository.create(
              {
                memberId,
                trainerId: dto.trainerId,
                startAt: dto.startAt,
                endAt: dto.endAt,
                status: TrainerBookingStatus.PENDING_REVIEW,
                price: this.getTrainerPriceForDuration(trainer, durationMinutes),
                currency: TRAINER_BOOKING_DEFAULT_CURRENCY,
                notes: dto.notes ?? null,
              },
              tx,
            );
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        ),
      'The selected trainer slot was just booked. Please choose another time slot.',
    );

    await this.emitBookingRequestedNotifications(createdBooking);

    return createdBooking;
  }

  async findMine(memberId: string): Promise<TrainerBookingEntity[]> {
    await this.expireStaleBookings();
    return this.trainerBookingRepository.listByMemberId(memberId);
  }

  async findTrainerMine(trainerId: string): Promise<TrainerBookingEntity[]> {
    await this.expireStaleBookings();
    return this.trainerBookingRepository.listByTrainerId(trainerId);
  }

  async findOneAuthorized(
    bookingId: string,
    user: RequestUser,
  ): Promise<TrainerBookingEntity> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);

    if (
      !user.roles.includes(ERoleName.ADMIN) &&
      !user.roles.includes(ERoleName.STAFF) &&
      booking.memberId !== user.sub &&
      booking.trainerId !== user.sub
    ) {
      throw new ForbiddenException('You are not allowed to view this booking');
    }

    return booking;
  }

  async accept(
    bookingId: string,
    trainerId: string,
  ): Promise<TrainerBookingEntity> {
    await this.expireStaleBookings();
    const updatedBooking = await this.runSerializableRetry(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const booking = await this.trainerBookingRepository.findRawById(
              bookingId,
              tx,
            );
            if (!booking) {
              throw new NotFoundException(`Trainer booking ${bookingId} not found`);
            }

            await this.lockBookingActors(tx, booking.trainerId, booking.memberId);

            if (booking.trainerId !== trainerId) {
              throw new ForbiddenException(
                'You can only accept your own booking requests',
              );
            }

            if (booking.status !== TrainerBookingStatus.PENDING_REVIEW) {
              throw new BadRequestException('Only pending bookings can be accepted');
            }

            await this.ensureNoCrossDomainConflicts(
              tx,
              booking.trainerId,
              booking.memberId,
              booking.startAt,
              booking.endAt,
              booking.id,
            );
            return this.trainerBookingRepository.update(
              bookingId,
              {
                status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
              },
              tx,
            );
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        ),
      'This booking was updated by another request. Refresh and try again.',
    );

    await this.emitBookingAcceptedNotifications(updatedBooking);

    return updatedBooking;
  }

  async reject(
    bookingId: string,
    trainerId: string,
    dto: TrainerBookingActionDto,
  ): Promise<TrainerBookingEntity> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);

    if (booking.trainerId !== trainerId) {
      throw new ForbiddenException('You can only reject your own booking requests');
    }

    if (booking.status === TrainerBookingStatus.REJECTED) {
      return booking;
    }

    if (booking.status !== TrainerBookingStatus.PENDING_REVIEW) {
      throw new BadRequestException('Only pending bookings can be rejected');
    }

    const updatedBooking = await this.trainerBookingRepository.update(bookingId, {
      status: TrainerBookingStatus.REJECTED,
      cancelReason: dto.reason ?? null,
      cancelledAt: new Date(),
    });

    await this.emitBookingRejectedNotifications(updatedBooking);

    return updatedBooking;
  }

  async cancel(
    bookingId: string,
    user: RequestUser,
    dto: TrainerBookingActionDto,
  ): Promise<TrainerBookingEntity> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);

    const isAdminOrStaff =
      user.roles.includes(ERoleName.ADMIN) ||
      user.roles.includes(ERoleName.STAFF);
    const isMember = booking.memberId === user.sub;
    const isTrainer = booking.trainerId === user.sub;

    if (!isAdminOrStaff && !isMember && !isTrainer) {
      throw new ForbiddenException('You are not allowed to cancel this booking');
    }

    if (
      booking.status === TrainerBookingStatus.COMPLETED ||
      booking.status === TrainerBookingStatus.NO_SHOW
    ) {
      throw new BadRequestException('Historical bookings cannot be cancelled');
    }

    if (
      booking.status === TrainerBookingStatus.REJECTED ||
      booking.status === TrainerBookingStatus.PAYMENT_FAILED ||
      booking.status === TrainerBookingStatus.EXPIRED ||
      booking.status === TrainerBookingStatus.CANCELLED
    ) {
      throw new BadRequestException('This booking is already inactive');
    }

    if (isMember) {
      this.assertMemberCancellationAllowed(booking);
    } else if (isTrainer) {
      this.assertTrainerCancellationAllowed(booking, dto);
    } else if (isAdminOrStaff) {
      this.assertAdminCancellationAllowed(booking);
    }

    const updatedBooking = await this.trainerBookingRepository.update(bookingId, {
      status: TrainerBookingStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: dto.reason ?? null,
    });

    await this.emitBookingCancelledNotifications(updatedBooking);

    return updatedBooking;
  }

  async complete(
    bookingId: string,
    user: RequestUser,
  ): Promise<TrainerBookingEntity> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);
    const canComplete =
      user.roles.includes(ERoleName.ADMIN) ||
      user.roles.includes(ERoleName.STAFF) ||
      booking.trainerId === user.sub;

    if (!canComplete) {
      throw new ForbiddenException('You are not allowed to complete this booking');
    }

    if (booking.status !== TrainerBookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed bookings can be completed');
    }

    return this.trainerBookingRepository.update(bookingId, {
      status: TrainerBookingStatus.COMPLETED,
    });
  }

  async confirmByPayment(
    bookingId: string,
    paymentId: string,
  ): Promise<TrainerBookingEntity> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);

    if (booking.status === TrainerBookingStatus.CONFIRMED) {
      return booking;
    }

    if (booking.status !== TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT) {
      this.logger.warn(
        `Trainer booking ${bookingId} is ${booking.status}, cannot confirm by payment`,
      );
      return booking;
    }

    const updatedBooking = await this.trainerBookingRepository.update(bookingId, {
      status: TrainerBookingStatus.CONFIRMED,
      paymentId,
    });

    await this.emitBookingConfirmedNotifications(updatedBooking);

    return updatedBooking;
  }

  async failByPayment(
    bookingId: string,
    paymentId: string,
    reason: string,
  ): Promise<TrainerBookingEntity | null> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);

    if (booking.status === TrainerBookingStatus.PAYMENT_FAILED) {
      return null;
    }

    if (booking.status !== TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT) {
      this.logger.warn(
        `Trainer booking ${bookingId} is ${booking.status}, cannot mark payment failed`,
      );
      return null;
    }

    return this.trainerBookingRepository.update(bookingId, {
      status: TrainerBookingStatus.PAYMENT_FAILED,
      paymentId,
      cancelReason: reason,
    });
  }

  async expireByPaymentTimeout(
    bookingId: string,
    paymentId: string,
    reason: string,
  ): Promise<TrainerBookingEntity | null> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);

    if (booking.status === TrainerBookingStatus.EXPIRED) {
      return null;
    }

    if (booking.status !== TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT) {
      this.logger.warn(
        `Trainer booking ${bookingId} is ${booking.status}, cannot mark payment expired`,
      );
      return null;
    }

    return this.trainerBookingRepository.update(bookingId, {
      status: TrainerBookingStatus.EXPIRED,
      paymentId,
      cancelReason: reason,
    });
  }

  async cancelByRefund(
    bookingId: string,
    paymentId: string,
  ): Promise<TrainerBookingEntity | null> {
    await this.expireStaleBookings();
    const booking = await this.getBookingOrThrow(bookingId);

    if (
      booking.status !== TrainerBookingStatus.CONFIRMED &&
      booking.status !== TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT
    ) {
      return null;
    }

    const updatedBooking = await this.trainerBookingRepository.update(bookingId, {
      status: TrainerBookingStatus.CANCELLED,
      paymentId,
      cancelledAt: new Date(),
      cancelReason: 'PAYMENT_REFUNDED',
    });

    await this.emitBookingCancelledNotifications(updatedBooking);

    return updatedBooking;
  }

  async expireStaleBookings(): Promise<number> {
    const now = new Date();
    const pendingReview = await this.trainerBookingRepository.expirePendingReview(
      now,
    );
    const pendingPayment =
      await this.trainerBookingRepository.expirePendingPayment(now);

    return pendingReview + pendingPayment;
  }

  async isMessagingEligible(
    memberId: string,
    trainerId: string,
  ): Promise<boolean> {
    await this.expireStaleBookings();
    const eligibleBooking = await this.prisma.trainerBooking.findFirst({
      where: this.buildMessagingEligibilityWhere({
        memberId,
        trainerId,
      }),
      orderBy: { endAt: 'desc' },
    });

    return Boolean(eligibleBooking);
  }

  async listMessagingEligibleTrainers(
    memberId: string,
  ): Promise<TrainerMessagingEligibleContact[]> {
    await this.expireStaleBookings();

    const bookings = await this.prisma.trainerBooking.findMany({
      where: this.buildMessagingEligibilityWhere({ memberId }),
      orderBy: { endAt: 'desc' },
      select: {
        trainer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return this.deduplicateMessagingContacts(
      bookings.map((booking) => booking.trainer),
    );
  }

  async listMessagingEligibleMembers(
    trainerId: string,
  ): Promise<TrainerMessagingEligibleContact[]> {
    await this.expireStaleBookings();

    const bookings = await this.prisma.trainerBooking.findMany({
      where: this.buildMessagingEligibilityWhere({ trainerId }),
      orderBy: { endAt: 'desc' },
      select: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return this.deduplicateMessagingContacts(
      bookings.map((booking) => booking.member),
    );
  }

  async sendUpcomingReminders(now: Date = new Date()): Promise<number> {
    const reminderWindowEnd = new Date(
      now.getTime() + TRAINER_BOOKING_REMINDER_LOOKAHEAD_HOURS * 60 * 60 * 1000,
    );
    const reminderDedupWindowStart = new Date(
      now.getTime() - TRAINER_BOOKING_REMINDER_LOOKAHEAD_HOURS * 60 * 60 * 1000,
    );

    const upcomingBookings = await this.prisma.trainerBooking.findMany({
      where: {
        status: TrainerBookingStatus.CONFIRMED,
        startAt: {
          gt: now,
          lte: reminderWindowEnd,
        },
      },
      include: {
        member: true,
        trainer: true,
      },
      orderBy: {
        startAt: 'asc',
      },
    });

    let sentCount = 0;

    for (const upcomingBooking of upcomingBookings) {
      const booking = toTrainerBookingEntity(upcomingBooking);
      const recipients = [
        booking.member,
        booking.trainer,
      ].filter((participant): participant is NonNullable<typeof booking.member> =>
        Boolean(participant),
      );

      for (const recipient of recipients) {
        const hasExistingReminder = await this.prisma.notification.count({
          where: {
            userId: recipient.id,
            type: NotificationType.BOOKING,
            referenceId: booking.id,
            title: TRAINER_BOOKING_REMINDER_TITLE,
            createdAt: {
              gte: reminderDedupWindowStart,
            },
          },
        });

        if (hasExistingReminder > 0) {
          continue;
        }

        const payload = this.buildNotificationPayload(
          recipient.id,
          recipient.email,
          `${recipient.firstName} ${recipient.lastName}`.trim(),
          NotificationType.BOOKING,
          TRAINER_BOOKING_REMINDER_TITLE,
          recipient.id === booking.memberId
            ? `Reminder: your trainer session starts at ${booking.startAt.toISOString()}.`
            : `Reminder: your trainer session with ${booking.member?.firstName ?? 'your member'} starts at ${booking.startAt.toISOString()}.`,
          booking.id,
          {
            eventKey: NOTIFICATION_EVENTS.TRAINER_BOOKING_REMINDER,
            bookingId: booking.id,
            bookingStatus: booking.status,
            startAt: booking.startAt.toISOString(),
            endAt: booking.endAt.toISOString(),
          },
        );

        await this.eventEmitter.emitAsync(
          NOTIFICATION_EVENTS.TRAINER_BOOKING_REMINDER,
          payload,
        );
        sentCount += 1;
      }
    }

    return sentCount;
  }

  private validateWindow(startAt: Date, endAt: Date): void {
    if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Booking startAt is invalid');
    }

    if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Booking endAt is invalid');
    }

    if (startAt >= endAt) {
      throw new BadRequestException('Booking startAt must be before endAt');
    }

    if (startAt <= new Date()) {
      throw new BadRequestException('Bookings cannot be created in the past');
    }

    const durationMinutes = minutesBetween(startAt, endAt);
    if (!isValidDurationMinutes(durationMinutes)) {
      throw new BadRequestException(
        `Trainer bookings must be one of ${TRAINER_BOOKING_SUPPORTED_DURATIONS.join(', ')} minutes`,
      );
    }
  }

  private buildMessagingEligibilityWhere(params: {
    memberId?: string;
    trainerId?: string;
  }): Prisma.TrainerBookingWhereInput {
    const supportWindowStart = this.getMessagingSupportWindowStart();

    return {
      ...(params.memberId ? { memberId: params.memberId } : {}),
      ...(params.trainerId ? { trainerId: params.trainerId } : {}),
      OR: [
        {
          status: TrainerBookingStatus.CONFIRMED,
          endAt: { gte: supportWindowStart },
        },
        {
          status: TrainerBookingStatus.COMPLETED,
          endAt: { gte: supportWindowStart },
        },
      ],
    };
  }

  private getMessagingSupportWindowStart(now: Date = new Date()): Date {
    return new Date(
      now.getTime() -
        TRAINER_BOOKING_MESSAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  private deduplicateMessagingContacts(
    contacts: TrainerMessagingEligibleContact[],
  ): TrainerMessagingEligibleContact[] {
    const byId = new Map<string, TrainerMessagingEligibleContact>();

    for (const contact of contacts) {
      if (!byId.has(contact.id)) {
        byId.set(contact.id, contact);
      }
    }

    return [...byId.values()];
  }

  private async runSerializableRetry<T>(
    operation: () => Promise<T>,
    finalMessage: string,
    maxAttempts = 2,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.isSerializableConflict(error) || attempt === maxAttempts - 1) {
          break;
        }
      }
    }

    if (this.isSerializableConflict(lastError)) {
      throw new BadRequestException(finalMessage);
    }

    throw lastError;
  }

  private isSerializableConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private async getBookingOrThrow(id: string): Promise<TrainerBookingEntity> {
    const booking = await this.trainerBookingRepository.findById(id);
    if (!booking) {
      throw new NotFoundException(`Trainer booking ${id} not found`);
    }

    return booking;
  }

  private async getTrainerProfileOrThrow(
    trainerId: string,
    db: DbClient,
  ): Promise<TrainerProfileRecord> {
    const trainer = await db.user.findFirst({
      where: {
        id: trainerId,
        userRole: {
          some: {
            role: {
              name: ERoleName.TRAINER,
            },
          },
        },
      },
      include: {
        userRole: { include: { role: true } },
        userMembership: { include: { membership: true } },
        trainerAvailabilities: true,
      },
    });

    if (!trainer) {
      throw new NotFoundException(`Trainer ${trainerId} not found`);
    }

    return trainer;
  }

  private async ensureActiveMembership(
    memberId: string,
    db: DbClient,
  ): Promise<void> {
    const now = new Date();
    const membership = await db.userMembership.findFirst({
      where: {
        userId: memberId,
        status: 'normal',
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { endDate: 'desc' },
    });

    if (!membership) {
      throw new ForbiddenException(
        'An active membership is required to book a trainer',
      );
    }
  }

  private async hasActiveMembership(memberId: string): Promise<boolean> {
    const now = new Date();
    const membership = await this.prisma.userMembership.findFirst({
      where: {
        userId: memberId,
        status: 'normal',
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });

    return Boolean(membership);
  }

  private async ensureNoCrossDomainConflicts(
    db: DbClient,
    trainerId: string,
    memberId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
  ): Promise<void> {
    await this.ensureTrainerWithinAvailability(db, trainerId, startAt, endAt);

    const trainerBookingConflict =
      await this.trainerBookingRepository.findBlockingOverlapForTrainer(
        {
          trainerId,
          startAt,
          endAt,
          excludeBookingId,
        },
        db,
      );

    if (trainerBookingConflict) {
      throw new BadRequestException(
        'The trainer already has a booking during this time',
      );
    }

    const memberBookingConflict =
      await this.trainerBookingRepository.findBlockingOverlapForMember(
        {
          memberId,
          startAt,
          endAt,
          excludeBookingId,
        },
        db,
      );

    if (memberBookingConflict) {
      throw new BadRequestException(
        'The member already has a trainer booking during this time',
      );
    }

    const trainerClassConflict = await this.findTrainerClassConflict(
      db,
      trainerId,
      startAt,
      endAt,
    );
    if (trainerClassConflict) {
      throw new BadRequestException(
        'The trainer already has an active class scheduled during this time',
      );
    }

    const memberClassConflict = await this.findMemberClassConflict(
      db,
      memberId,
      startAt,
      endAt,
    );
    if (memberClassConflict) {
      throw new BadRequestException(
        'The member already has a class booking during this time',
      );
    }
  }

  private async ensureTrainerWithinAvailability(
    db: DbClient,
    trainerId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    const dayOfWeek = dayOfWeekToIndex(startAt);
    const availabilities = await db.trainerAvailability.findMany({
      where: {
        trainerId,
        dayOfWeek,
        isAvailable: true,
      },
    });

    const requestedStart = startAt.getUTCHours() * 60 + startAt.getUTCMinutes();
    const requestedEnd = endAt.getUTCHours() * 60 + endAt.getUTCMinutes();
    const isInsideWorkingHours = availabilities.some((slot) => {
      const slotStart =
        slot.startTime.getUTCHours() * 60 + slot.startTime.getUTCMinutes();
      const slotEnd =
        slot.endTime.getUTCHours() * 60 + slot.endTime.getUTCMinutes();

      return requestedStart >= slotStart && requestedEnd <= slotEnd;
    });

    if (!isInsideWorkingHours) {
      throw new BadRequestException(
        'The requested time is outside the trainer working hours',
      );
    }
  }

  private async findTrainerClassConflict(
    db: DbClient,
    trainerId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<ClassScheduleConflictRecord | null> {
    const dayStart = startOfUtcDay(startAt);
    const dayOfWeek = this.dateToDayOfWeek(startAt);

    const schedules = await db.classSchedule.findMany({
      where: {
        trainerId,
        isActive: true,
        AND: [
          {
            OR: [{ validFrom: null }, { validFrom: { lte: dayStart } }],
          },
          {
            OR: [{ validUntil: null }, { validUntil: { gte: dayStart } }],
          },
          {
            OR: [
              { dayOfWeek },
              {
                scheduleDays: {
                  some: { dayOfWeek },
                },
              },
            ],
          },
        ],
      },
      include: {
        scheduleDays: true,
        scheduleExceptions: {
          where: {
            exceptionDate: dayStart,
          },
        },
      },
    });

    for (const schedule of schedules) {
      const range = this.resolveClassScheduleRangeForDate(schedule, startAt);
      if (range && overlaps(range, { startAt, endAt })) {
        return schedule;
      }
    }

    return null;
  }

  private async findMemberClassConflict(
    db: DbClient,
    memberId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<ClassBookingConflictRecord | null> {
    const dayStart = startOfUtcDay(startAt);

    const bookings = await db.classBooking.findMany({
      where: {
        userId: memberId,
        status: {
          not: 'cancelled',
        },
        bookingStartDate: { lte: dayStart },
        bookingEndDate: { gte: dayStart },
      },
      include: {
        classSchedule: {
          include: {
            scheduleDays: true,
            scheduleExceptions: {
              where: {
                exceptionDate: dayStart,
              },
            },
          },
        },
      },
    });

    for (const booking of bookings) {
      if (!booking.classSchedule) {
        continue;
      }

      const range = this.resolveClassScheduleRangeForDate(
        booking.classSchedule,
        startAt,
      );

      if (range && overlaps(range, { startAt, endAt })) {
        return booking;
      }
    }

    return null;
  }

  private resolveClassScheduleRangeForDate(
    schedule: ClassScheduleConflictRecord,
    targetDate: Date,
  ): TimeRange | null {
    if (!schedule.isActive) {
      return null;
    }

    const targetDayStart = startOfUtcDay(targetDate);
    if (schedule.validFrom && schedule.validFrom > targetDayStart) {
      return null;
    }
    if (schedule.validUntil && schedule.validUntil < targetDayStart) {
      return null;
    }

    const targetDay = this.dateToDayOfWeek(targetDate);
    const matchesDay =
      schedule.scheduleDays.length > 0
        ? schedule.scheduleDays.some((item) => item.dayOfWeek === targetDay)
        : schedule.dayOfWeek === targetDay;

    if (!matchesDay) {
      return null;
    }

    const exception = schedule.scheduleExceptions[0];
    if (exception?.type === ExceptionType.CANCELLED) {
      return null;
    }

    const rangeStart = createUtcDate(
      targetDate,
      exception?.type === ExceptionType.RESCHEDULED && exception.newStartTime
        ? exception.newStartTime
        : schedule.startTime,
    );
    const rangeEnd = createUtcDate(
      targetDate,
      exception?.type === ExceptionType.RESCHEDULED && exception.newEndTime
        ? exception.newEndTime
        : schedule.endTime,
    );

    return { startAt: rangeStart, endAt: rangeEnd };
  }

  private async getAvailableSlotsForTrainer(
    trainerId: string,
    from: Date,
    to: Date,
    memberId?: string,
  ): Promise<Array<{ startAt: Date; endAt: Date; durations: number[] }>> {
    const trainer = await this.getTrainerProfileOrThrow(trainerId, this.prisma);
    const dayRanges = new Map<string, TimeRange[]>();
    const currentDay = startOfUtcDay(from);
    const lastDay = startOfUtcDay(to);

    for (
      let cursor = new Date(currentDay);
      cursor <= lastDay;
      cursor = addMinutes(cursor, 24 * 60)
    ) {
      const dayBaseRanges = trainer.trainerAvailabilities
        .filter(
          (slot) =>
            slot.isAvailable && slot.dayOfWeek === dayOfWeekToIndex(cursor),
        )
        .map((slot) => ({
          startAt: createUtcDate(cursor, slot.startTime),
          endAt: createUtcDate(cursor, slot.endTime),
        }));

      dayRanges.set(startOfUtcDay(cursor).toISOString(), dayBaseRanges);
    }

    const blockingBookings =
      await this.trainerBookingRepository.listBlockingBookingsForTrainerInRange({
        trainerId,
        from,
        to: endOfUtcDay(to),
      });

    const blockedByDay = new Map<string, TimeRange[]>();
    for (const booking of blockingBookings) {
      const key = startOfUtcDay(booking.startAt).toISOString();
      const ranges = blockedByDay.get(key) ?? [];
      ranges.push({ startAt: booking.startAt, endAt: booking.endAt });
      blockedByDay.set(key, ranges);
    }

    for (
      let cursor = new Date(currentDay);
      cursor <= lastDay;
      cursor = addMinutes(cursor, 24 * 60)
    ) {
      const key = startOfUtcDay(cursor).toISOString();
      const trainerClassConflict = await this.listTrainerClassRangesForDay(
        trainerId,
        cursor,
      );
      if (trainerClassConflict.length === 0) {
        continue;
      }

      const ranges = blockedByDay.get(key) ?? [];
      ranges.push(...trainerClassConflict);
      blockedByDay.set(key, ranges);
    }

    if (memberId) {
      const memberBlockingBookings =
        await this.trainerBookingRepository.listBlockingBookingsForMemberInRange({
          memberId,
          from,
          to: endOfUtcDay(to),
        });

      for (const booking of memberBlockingBookings) {
        const key = startOfUtcDay(booking.startAt).toISOString();
        const ranges = blockedByDay.get(key) ?? [];
        ranges.push({ startAt: booking.startAt, endAt: booking.endAt });
        blockedByDay.set(key, ranges);
      }

      for (
        let cursor = new Date(currentDay);
        cursor <= lastDay;
        cursor = addMinutes(cursor, 24 * 60)
      ) {
        const key = startOfUtcDay(cursor).toISOString();
        const memberClassConflict = await this.listMemberClassRangesForDay(
          memberId,
          cursor,
        );

        if (memberClassConflict.length === 0) {
          continue;
        }

        const ranges = blockedByDay.get(key) ?? [];
        ranges.push(...memberClassConflict);
        blockedByDay.set(key, ranges);
      }
    }

    const availableSlots: Array<{
      startAt: Date;
      endAt: Date;
      durations: number[];
    }> = [];
    const now = new Date();

    for (const [dayKey, baseRanges] of dayRanges.entries()) {
      const blocked = blockedByDay.get(dayKey) ?? [];
      const freeRanges = subtractTimeRanges(baseRanges, blocked).map((range) => {
        if (!sameCalendarDay(range.startAt, now)) {
          return range;
        }

        if (range.endAt <= now) {
          return null;
        }

        return {
          startAt: range.startAt < now ? now : range.startAt,
          endAt: range.endAt,
        };
      }).filter((range): range is TimeRange => Boolean(range));

      for (const range of freeRanges) {
        const durationOptions = TRAINER_BOOKING_SUPPORTED_DURATIONS.filter(
          (duration) => duration <= minutesBetween(range.startAt, range.endAt),
        );

        if (durationOptions.length === 0) {
          continue;
        }

        availableSlots.push({
          startAt: range.startAt,
          endAt: range.endAt,
          durations: [...durationOptions],
        });
      }
    }

    return availableSlots.sort(
      (left, right) => left.startAt.getTime() - right.startAt.getTime(),
    );
  }

  private getConflictScopedMemberId(
    currentUser?: Pick<RequestUser, 'sub' | 'roles'>,
  ): string | undefined {
    if (!currentUser?.roles.includes(ERoleName.MEMBER)) {
      return undefined;
    }

    return currentUser.sub;
  }

  private async listTrainerClassRangesForDay(
    trainerId: string,
    day: Date,
  ): Promise<TimeRange[]> {
    const dayStart = startOfUtcDay(day);
    const dayOfWeek = this.dateToDayOfWeek(day);
    const schedules = await this.prisma.classSchedule.findMany({
      where: {
        trainerId,
        isActive: true,
        AND: [
          {
            OR: [{ validFrom: null }, { validFrom: { lte: dayStart } }],
          },
          {
            OR: [{ validUntil: null }, { validUntil: { gte: dayStart } }],
          },
          {
            OR: [
              { dayOfWeek },
              {
                scheduleDays: {
                  some: {
                    dayOfWeek,
                  },
                },
              },
            ],
          },
        ],
      },
      include: {
        scheduleDays: true,
        scheduleExceptions: {
          where: {
            exceptionDate: dayStart,
          },
        },
      },
    });

    return schedules
      .map((schedule) => this.resolveClassScheduleRangeForDate(schedule, day))
      .filter((range): range is TimeRange => Boolean(range));
  }

  private async listMemberClassRangesForDay(
    memberId: string,
    day: Date,
  ): Promise<TimeRange[]> {
    const dayStart = startOfUtcDay(day);
    const bookings = await this.prisma.classBooking.findMany({
      where: {
        userId: memberId,
        status: {
          not: 'cancelled',
        },
        bookingStartDate: { lte: dayStart },
        bookingEndDate: { gte: dayStart },
      },
      include: {
        classSchedule: {
          include: {
            scheduleDays: true,
            scheduleExceptions: {
              where: {
                exceptionDate: dayStart,
              },
            },
          },
        },
      },
    });

    return bookings
      .map((booking) => {
        if (!booking.classSchedule) {
          return null;
        }

        return this.resolveClassScheduleRangeForDate(booking.classSchedule, day);
      })
      .filter((range): range is TimeRange => Boolean(range));
  }

  private assertMemberCancellationAllowed(booking: TrainerBookingEntity): void {
    if (booking.status === TrainerBookingStatus.PENDING_REVIEW) {
      return;
    }
    if (booking.status === TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT) {
      return;
    }
    if (booking.status === TrainerBookingStatus.CONFIRMED) {
      if (booking.startAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
        throw new BadRequestException(
          'Confirmed bookings can only be cancelled at least 24 hours before the session',
        );
      }
      return;
    }

    throw new BadRequestException('Members cannot cancel this booking state');
  }

  private assertTrainerCancellationAllowed(
    booking: TrainerBookingEntity,
    dto: TrainerBookingActionDto,
  ): void {
    if (booking.status === TrainerBookingStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        'Pending review bookings should be rejected, not cancelled',
      );
    }

    if (booking.status === TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT) {
      return;
    }

    if (booking.status === TrainerBookingStatus.CONFIRMED) {
      if (!dto.reason?.trim()) {
        throw new BadRequestException(
          'A cancellation reason is required when a trainer cancels a confirmed booking',
        );
      }
      return;
    }

    throw new BadRequestException('Trainers cannot cancel this booking state');
  }

  private assertAdminCancellationAllowed(booking: TrainerBookingEntity): void {
    if (
      booking.status === TrainerBookingStatus.PENDING_REVIEW ||
      booking.status === TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT ||
      booking.status === TrainerBookingStatus.CONFIRMED
    ) {
      return;
    }

    throw new BadRequestException(
      'Admin and staff can only cancel active trainer bookings',
    );
  }

  private dateToDayOfWeek(date: Date): DayOfWeek {
    const value = date.getUTCDay();
    const map: Record<number, DayOfWeek> = {
      0: DayOfWeek.SUN,
      1: DayOfWeek.MON,
      2: DayOfWeek.TUE,
      3: DayOfWeek.WED,
      4: DayOfWeek.THU,
      5: DayOfWeek.FRI,
      6: DayOfWeek.SAT,
    };

    return map[value];
  }

  private matchesPriceFilter(
    pricing: Record<number, number>,
    query: TrainerBookingTrainerQueryDto,
  ): boolean {
    const prices = Object.values(pricing);

    return prices.some((value) => {
      if (query.priceMin !== undefined && value < query.priceMin) {
        return false;
      }
      if (query.priceMax !== undefined && value > query.priceMax) {
        return false;
      }
      return true;
    });
  }

  private getTrainerPriceForDuration(
    trainer: Pick<
      TrainerProfileRecord,
      'ptSessionPrice30' | 'ptSessionPrice60' | 'ptSessionPrice90'
    >,
    durationMinutes: number,
  ): number {
    const pricing = toTrainerPricing(trainer);
    const price = pricing[durationMinutes];

    if (price === undefined) {
      throw new BadRequestException(
        `Trainer does not have a configured price for ${durationMinutes} minute sessions`,
      );
    }

    return price;
  }

  private async emitBookingRequestedNotifications(
    booking: TrainerBookingEntity,
  ): Promise<void> {
    await this.emitBookingNotifications(
      NOTIFICATION_EVENTS.TRAINER_BOOKING_CREATED,
      booking,
      (audience) => ({
        type: NotificationType.BOOKING,
        title:
          audience === 'member'
            ? 'Trainer booking requested'
            : 'New trainer booking request',
        message:
          audience === 'member'
            ? 'Your trainer booking request has been submitted and is awaiting trainer review.'
            : `A member requested a trainer session starting at ${booking.startAt.toISOString()}.`,
      }),
    );
  }

  private async emitBookingAcceptedNotifications(
    booking: TrainerBookingEntity,
  ): Promise<void> {
    await this.emitBookingNotifications(
      NOTIFICATION_EVENTS.TRAINER_BOOKING_ACCEPTED,
      booking,
      (audience) => ({
        type: NotificationType.BOOKING,
        title: 'Trainer booking accepted',
        message:
          audience === 'member'
            ? 'Your trainer booking was accepted. Complete payment to confirm the session.'
            : 'You accepted a trainer booking request. Waiting for member payment.',
      }),
    );
  }

  private async emitBookingRejectedNotifications(
    booking: TrainerBookingEntity,
  ): Promise<void> {
    await this.emitBookingNotifications(
      NOTIFICATION_EVENTS.TRAINER_BOOKING_REJECTED,
      booking,
      (audience) => ({
        type: NotificationType.BOOKING,
        title: 'Trainer booking rejected',
        message:
          audience === 'member'
            ? 'Your trainer booking request was rejected by the trainer.'
            : 'The trainer booking request has been marked as rejected.',
      }),
    );
  }

  private async emitBookingConfirmedNotifications(
    booking: TrainerBookingEntity,
  ): Promise<void> {
    await this.emitBookingNotifications(
      NOTIFICATION_EVENTS.TRAINER_BOOKING_CONFIRMED,
      booking,
      (audience) => ({
        type: NotificationType.BOOKING,
        title: 'Trainer booking confirmed',
        message:
          audience === 'member'
            ? 'Your trainer booking is confirmed and fully paid.'
            : 'A trainer booking is now confirmed after successful payment.',
      }),
    );
  }

  private async emitBookingCancelledNotifications(
    booking: TrainerBookingEntity,
  ): Promise<void> {
    const reasonSuffix = booking.cancelReason
      ? ` Reason: ${booking.cancelReason}.`
      : '';

    await this.emitBookingNotifications(
      NOTIFICATION_EVENTS.TRAINER_BOOKING_CANCELLED,
      booking,
      () => ({
        type: NotificationType.BOOKING,
        title: 'Trainer booking cancelled',
        message: `A trainer booking was cancelled.${reasonSuffix}`,
      }),
    );
  }

  private async emitBookingNotifications(
    eventName: string,
    booking: TrainerBookingEntity,
    factory: (
      audience: 'member' | 'trainer',
    ) => {
      type: NotificationType;
      title: string;
      message: string;
    },
  ): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    if (booking.member) {
      const config = factory('member');
      tasks.push(
        this.eventEmitter.emitAsync(
          eventName,
          this.buildNotificationPayload(
            booking.member.id,
            booking.member.email,
            `${booking.member.firstName} ${booking.member.lastName}`.trim(),
            config.type,
            config.title,
            config.message,
            booking.id,
            {
              eventKey: eventName,
              bookingId: booking.id,
              bookingStatus: booking.status,
              startAt: booking.startAt.toISOString(),
              endAt: booking.endAt.toISOString(),
            },
          ),
        ),
      );
    }

    if (booking.trainer) {
      const config = factory('trainer');
      tasks.push(
        this.eventEmitter.emitAsync(
          eventName,
          this.buildNotificationPayload(
            booking.trainer.id,
            booking.trainer.email,
            `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
            config.type,
            config.title,
            config.message,
            booking.id,
            {
              eventKey: eventName,
              bookingId: booking.id,
              bookingStatus: booking.status,
              startAt: booking.startAt.toISOString(),
              endAt: booking.endAt.toISOString(),
            },
          ),
        ),
      );
    }

    const results = await Promise.allSettled(tasks);
    const failures = results.filter((result) => result.status === 'rejected');

    if (failures.length > 0) {
      this.logger.warn(
        `Failed to emit ${failures.length} notification events for trainer booking ${booking.id}`,
      );
    }
  }

  private buildNotificationPayload(
    userId: string,
    userEmail: string,
    userName: string,
    type: NotificationType,
    title: string,
    message: string,
    referenceId: string,
    metadata?: Record<string, unknown>,
  ): NotificationEventPayload {
    return {
      userId,
      userEmail,
      userName,
      type,
      title,
      message,
      referenceId,
      metadata,
    };
  }

  private async lockBookingActors(
    tx: Prisma.TransactionClient,
    trainerId: string,
    memberId: string,
  ): Promise<void> {
    const actorIds = [...new Set([trainerId, memberId])].sort();

    for (const actorId of actorIds) {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId}::uuid FOR UPDATE`;
    }
  }
}
