import { TrainerBookingStatus } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  TRAINER_BOOKING_BLOCKING_STATUSES,
  TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS,
  TRAINER_BOOKING_PENDING_REVIEW_TTL_MS,
} from '../constants/trainer-booking.constants';
import { TrainerBookingRepository } from './trainer-booking.repository';

describe('TrainerBookingRepository', () => {
  let repository: TrainerBookingRepository;
  let prisma: jest.Mocked<any>;

  beforeEach(() => {
    prisma = {
      trainerBooking: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
      },
    };

    repository = new TrainerBookingRepository(prisma as unknown as PrismaService);
  });

  it('queries trainer overlaps with the blocking statuses and excludes the current booking when requested', async () => {
    await repository.findBlockingOverlapForTrainer({
      trainerId: 'trainer-1',
      startAt: new Date('2030-01-08T09:00:00.000Z'),
      endAt: new Date('2030-01-08T10:00:00.000Z'),
      excludeBookingId: 'booking-1',
    });

    expect(prisma.trainerBooking.findFirst).toHaveBeenCalledWith({
      where: {
        trainerId: 'trainer-1',
        status: { in: TRAINER_BOOKING_BLOCKING_STATUSES },
        startAt: { lt: new Date('2030-01-08T10:00:00.000Z') },
        endAt: { gt: new Date('2030-01-08T09:00:00.000Z') },
        id: { not: 'booking-1' },
      },
    });
  });

  it('queries member overlaps with the blocking statuses', async () => {
    await repository.findBlockingOverlapForMember({
      memberId: 'member-1',
      startAt: new Date('2030-01-08T09:00:00.000Z'),
      endAt: new Date('2030-01-08T10:00:00.000Z'),
    });

    expect(prisma.trainerBooking.findFirst).toHaveBeenCalledWith({
      where: {
        memberId: 'member-1',
        status: { in: TRAINER_BOOKING_BLOCKING_STATUSES },
        startAt: { lt: new Date('2030-01-08T10:00:00.000Z') },
        endAt: { gt: new Date('2030-01-08T09:00:00.000Z') },
      },
    });
  });

  it('lists blocking bookings for slot calculations using the same blocking status policy', async () => {
    await repository.listBlockingBookingsForTrainerInRange({
      trainerId: 'trainer-1',
      from: new Date('2030-01-08T00:00:00.000Z'),
      to: new Date('2030-01-09T00:00:00.000Z'),
    });

    expect(prisma.trainerBooking.findMany).toHaveBeenCalledWith({
      where: {
        trainerId: 'trainer-1',
        status: { in: TRAINER_BOOKING_BLOCKING_STATUSES },
        startAt: { lt: new Date('2030-01-09T00:00:00.000Z') },
        endAt: { gt: new Date('2030-01-08T00:00:00.000Z') },
      },
      orderBy: { startAt: 'asc' },
    });
  });

  it('expires pending review bookings after the 24-hour window or when startAt is reached', async () => {
    const now = new Date('2030-01-08T12:00:00.000Z');
    prisma.trainerBooking.updateMany.mockResolvedValue({ count: 2 });

    const result = await repository.expirePendingReview(now);

    expect(result).toBe(2);
    expect(prisma.trainerBooking.updateMany).toHaveBeenCalledWith({
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
  });

  it('expires accepted pending payment bookings after the 30-minute payment window', async () => {
    const now = new Date('2030-01-08T12:00:00.000Z');
    prisma.trainerBooking.updateMany.mockResolvedValue({ count: 1 });

    const result = await repository.expirePendingPayment(now);

    expect(result).toBe(1);
    expect(prisma.trainerBooking.updateMany).toHaveBeenCalledWith({
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
  });
});
