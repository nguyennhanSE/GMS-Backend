import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { CreateTrainerBookingDto } from './dto/create-trainer-booking.dto';
import { TrainerBookingActionDto } from './dto/trainer-booking-action.dto';
import { TrainerBookingRepository } from './repositories/trainer-booking.repository';
import { TrainerBookingService } from './trainer-booking.service';
import { NotificationType, TrainerBookingStatus } from '@prisma/client';

describe('TrainerBookingService', () => {
  let service: TrainerBookingService;
  let prisma: jest.Mocked<any>;
  let repository: jest.Mocked<any>;
  let eventEmitter: jest.Mocked<any>;

  const trainerId = 'trainer-1';
  const memberId = 'member-1';
  const now = new Date('2030-01-01T08:00:00.000Z');

  const trainerProfile = {
    id: trainerId,
    firstName: 'Trainer',
    lastName: 'One',
    email: 'trainer@test.local',
    password: 'secret',
    phone: null,
    gender: null,
    dob: null,
    address: null,
    status: 'active',
    avatarUrl: null,
    trainerSpecialization: 'Strength & Conditioning',
    trainerExperienceYears: 6,
    trainerBiography: 'Certified strength coach',
    trainerCertifications: ['NASM CPT'],
    trainerAreasOfExpertise: ['Hypertrophy', 'Mobility'],
    ptSessionPrice30: 150000,
    ptSessionPrice60: 250000,
    ptSessionPrice90: 350000,
    userRole: [],
    userMembership: [],
    trainerAvailabilities: [
      {
        id: 'availability-1',
        trainerId,
        dayOfWeek: 2,
        startTime: new Date('2030-01-01T08:00:00.000Z'),
        endTime: new Date('2030-01-01T12:00:00.000Z'),
        isAvailable: true,
      },
    ],
  };

  const booking = {
    id: 'booking-1',
    memberId,
    trainerId,
    startAt: new Date('2030-01-08T09:00:00.000Z'),
    endAt: new Date('2030-01-08T10:00:00.000Z'),
    status: TrainerBookingStatus.PENDING_REVIEW,
    price: 250000,
    currency: 'VND',
    paymentId: null,
    notes: 'Focus on form',
    cancelledAt: null,
    cancelReason: null,
    rescheduledFromBookingId: null,
    createdAt: new Date('2030-01-01T08:00:00.000Z'),
    updatedAt: new Date('2030-01-01T08:00:00.000Z'),
    member: {
      id: memberId,
      firstName: 'Member',
      lastName: 'One',
      email: 'member@test.local',
      phone: null,
      gender: null,
      dob: null,
      address: null,
      status: 'active',
      avatarUrl: null,
    },
    trainer: {
      id: trainerId,
      firstName: 'Trainer',
      lastName: 'One',
      email: 'trainer@test.local',
      phone: null,
      gender: null,
      dob: null,
      address: null,
      status: 'active',
      avatarUrl: null,
    },
  };

  const createTx = (overrides: Record<string, any> = {}) =>
    ({
      $queryRaw: jest.fn().mockResolvedValue([]),
      userMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          userId: memberId,
          status: 'normal',
          startDate: new Date('2029-12-01T00:00:00.000Z'),
          endDate: new Date('2030-12-31T00:00:00.000Z'),
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(trainerProfile),
      },
      trainerAvailability: {
        findMany: jest.fn().mockResolvedValue(trainerProfile.trainerAvailabilities),
      },
      trainerBooking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      classSchedule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      classBooking: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      notification: {
        count: jest.fn().mockResolvedValue(0),
      },
      ...overrides,
    }) as any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      user: {
        findMany: jest.fn().mockResolvedValue([trainerProfile]),
        findFirst: jest.fn().mockResolvedValue(trainerProfile),
      },
      userMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          userId: memberId,
          status: 'normal',
          startDate: new Date('2029-12-01T00:00:00.000Z'),
          endDate: new Date('2030-12-31T00:00:00.000Z'),
        }),
      },
      trainerAvailability: {
        findMany: jest.fn().mockResolvedValue(trainerProfile.trainerAvailabilities),
      },
      trainerBooking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      classSchedule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      classBooking: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      notification: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    repository = {
      findById: jest.fn().mockResolvedValue(booking),
      findRawById: jest.fn().mockResolvedValue(booking),
      listByMemberId: jest.fn().mockResolvedValue([booking]),
      listByTrainerId: jest.fn().mockResolvedValue([booking]),
      create: jest.fn().mockResolvedValue(booking),
      update: jest.fn().mockResolvedValue(booking),
      expirePendingReview: jest.fn().mockResolvedValue(0),
      expirePendingPayment: jest.fn().mockResolvedValue(0),
      listBlockingBookingsForTrainerInRange: jest.fn().mockResolvedValue([]),
      listBlockingBookingsForMemberInRange: jest.fn().mockResolvedValue([]),
      findBlockingOverlapForTrainer: jest.fn().mockResolvedValue(null),
      findBlockingOverlapForMember: jest.fn().mockResolvedValue(null),
    };
    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerBookingService,
        { provide: PrismaService, useValue: prisma },
        { provide: TrainerBookingRepository, useValue: repository },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(TrainerBookingService);
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a booking with active membership and derives price from duration', async () => {
    const dto: CreateTrainerBookingDto = {
      trainerId,
      startAt: new Date('2030-01-08T09:00:00.000Z'),
      endAt: new Date('2030-01-08T10:00:00.000Z'),
      notes: 'Focus on form',
    };

    const tx = createTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    const result = await service.create(memberId, dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId,
        trainerId,
        startAt: dto.startAt,
        endAt: dto.endAt,
        status: TrainerBookingStatus.PENDING_REVIEW,
        price: 250000,
        currency: 'VND',
        notes: 'Focus on form',
      }),
      tx,
    );
    expect(result.status).toBe(TrainerBookingStatus.PENDING_REVIEW);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        userId: memberId,
        type: NotificationType.BOOKING,
        referenceId: booking.id,
      }),
    );
  });

  it('filters trainer discovery by specialization and availability when requested', async () => {
    prisma.user.findMany.mockResolvedValue([
      trainerProfile,
      {
        ...trainerProfile,
        id: 'trainer-2',
        trainerSpecialization: 'Yoga',
        trainerAvailabilities: [],
      },
    ]);
    repository.listBlockingBookingsForTrainerInRange.mockResolvedValue([]);

    const result = await service.listBookableTrainers({
      specialization: 'Strength',
      availableOnly: true,
      date: new Date('2030-01-08T00:00:00.000Z'),
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          trainerSpecialization: {
            contains: 'Strength',
            mode: 'insensitive',
          },
        }),
      }),
    );
    expect(result[0].specialization).toBe('Strength & Conditioning');
  });

  it('applies member-side conflicts to trainer discovery availability', async () => {
    repository.listBlockingBookingsForTrainerInRange.mockResolvedValue([]);
    repository.listBlockingBookingsForMemberInRange.mockResolvedValue([
      {
        id: 'member-booking-1',
        memberId,
        startAt: new Date('2030-01-08T08:00:00.000Z'),
        endAt: new Date('2030-01-08T12:00:00.000Z'),
      },
    ]);

    const result = await service.listBookableTrainers(
      {
        availableOnly: true,
        date: new Date('2030-01-08T00:00:00.000Z'),
      },
      {
        sub: memberId,
        roles: [ERoleName.MEMBER],
      } as RequestUser,
    );

    expect(repository.listBlockingBookingsForMemberInRange).toHaveBeenCalledWith({
      memberId,
      from: new Date('2030-01-08T00:00:00.000Z'),
      to: new Date('2030-01-09T00:00:00.000Z'),
    });
    expect(result).toHaveLength(0);
  });

  it('rejects booking creation when the member has no active membership', async () => {
    prisma.$transaction.mockImplementation((callback: any) =>
      callback(
        createTx({
          userMembership: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      ),
    );

    await expect(
      service.create(memberId, {
        trainerId,
        startAt: new Date('2030-01-08T09:00:00.000Z'),
        endAt: new Date('2030-01-08T10:00:00.000Z'),
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects invalid booking durations before touching the transaction', async () => {
    await expect(
      service.create(memberId, {
        trainerId,
        startAt: new Date('2030-01-08T09:00:00.000Z'),
        endAt: new Date('2030-01-08T09:45:00.000Z'),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects trainer overlap conflicts', async () => {
    prisma.$transaction.mockImplementation((callback: any) => callback(createTx()));
    repository.findBlockingOverlapForTrainer.mockResolvedValueOnce({
      id: 'conflict',
    });

    await expect(
      service.create(memberId, {
        trainerId,
        startAt: new Date('2030-01-08T09:00:00.000Z'),
        endAt: new Date('2030-01-08T10:00:00.000Z'),
      }),
    ).rejects.toThrow(/trainer already has a booking/i);
  });

  it('rejects trainer class conflicts', async () => {
    prisma.$transaction.mockImplementation((callback: any) =>
      callback(
        createTx({
          classSchedule: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'class-1',
                trainerId,
                dayOfWeek: 'TUE',
                startTime: new Date('2030-01-01T09:30:00.000Z'),
                endTime: new Date('2030-01-01T10:30:00.000Z'),
                validFrom: null,
                validUntil: null,
                isActive: true,
                scheduleDays: [],
                scheduleExceptions: [],
              },
            ]),
          },
        }),
      ),
    );

    await expect(
      service.create(memberId, {
        trainerId,
        startAt: new Date('2030-01-08T09:00:00.000Z'),
        endAt: new Date('2030-01-08T10:00:00.000Z'),
      }),
    ).rejects.toThrow(/active class scheduled/i);
  });

  it('runs lazy expiry before slot queries and excludes blocking ranges from returned slots', async () => {
    repository.listBlockingBookingsForTrainerInRange.mockResolvedValue([
      {
        id: 'blocking-1',
        trainerId,
        startAt: new Date('2030-01-08T08:00:00.000Z'),
        endAt: new Date('2030-01-08T11:00:00.000Z'),
      },
    ]);

    const result = await service.getTrainerSlots(trainerId, {
      from: new Date('2030-01-08T00:00:00.000Z'),
      to: new Date('2030-01-08T00:00:00.000Z'),
    });

    expect(repository.expirePendingReview).toHaveBeenCalled();
    expect(repository.expirePendingPayment).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].startAt.toISOString()).toBe('2030-01-08T11:00:00.000Z');
  });

  it('filters slot queries with member-side PT and class conflicts for member viewers', async () => {
    repository.listBlockingBookingsForMemberInRange.mockResolvedValue([
      {
        id: 'member-booking-1',
        memberId,
        startAt: new Date('2030-01-08T08:00:00.000Z'),
        endAt: new Date('2030-01-08T09:00:00.000Z'),
      },
    ]);
    prisma.classBooking.findMany.mockResolvedValue([
      {
        id: 'class-booking-1',
        classSchedule: {
          id: 'class-1',
          trainerId,
          dayOfWeek: 'TUE',
          startTime: new Date('2030-01-01T10:00:00.000Z'),
          endTime: new Date('2030-01-01T11:00:00.000Z'),
          validFrom: null,
          validUntil: null,
          isActive: true,
          scheduleDays: [],
          scheduleExceptions: [],
        },
      },
    ]);

    const result = await service.getTrainerSlots(
      trainerId,
      {
        from: new Date('2030-01-08T00:00:00.000Z'),
        to: new Date('2030-01-08T00:00:00.000Z'),
      },
      {
        sub: memberId,
        roles: [ERoleName.MEMBER],
      } as RequestUser,
    );

    expect(result).toHaveLength(2);
    expect(result[0].startAt.toISOString()).toBe('2030-01-08T09:00:00.000Z');
    expect(result[0].endAt.toISOString()).toBe('2030-01-08T10:00:00.000Z');
    expect(result[1].startAt.toISOString()).toBe('2030-01-08T11:00:00.000Z');
    expect(result[1].endAt.toISOString()).toBe('2030-01-08T12:00:00.000Z');
  });

  it('rejects member class conflicts', async () => {
    prisma.$transaction.mockImplementation((callback: any) =>
      callback(
        createTx({
          classBooking: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'class-booking-1',
                classSchedule: {
                  id: 'class-1',
                  trainerId,
                  dayOfWeek: 'TUE',
                  startTime: new Date('2030-01-01T09:30:00.000Z'),
                  endTime: new Date('2030-01-01T10:30:00.000Z'),
                  validFrom: null,
                  validUntil: null,
                  isActive: true,
                  scheduleDays: [],
                  scheduleExceptions: [],
                },
              },
            ]),
          },
        }),
      ),
    );

    await expect(
      service.create(memberId, {
        trainerId,
        startAt: new Date('2030-01-08T09:00:00.000Z'),
        endAt: new Date('2030-01-08T10:00:00.000Z'),
      }),
    ).rejects.toThrow(/class booking/i);
  });

  it('rejects confirmed bookings that are within the 24 hour member cancellation window', async () => {
    repository.findById.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.CONFIRMED,
      startAt: new Date('2030-01-02T07:00:00.000Z'),
    });
    const memberUser = {
      sub: memberId,
      roles: [ERoleName.MEMBER],
    } as RequestUser;

    await expect(
      service.cancel('booking-1', memberUser, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a member to cancel a pending review booking', async () => {
    repository.findById.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.PENDING_REVIEW,
    });
    repository.update.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.CANCELLED,
    });

    const result = await service.cancel(
      'booking-1',
      { sub: memberId, roles: [ERoleName.MEMBER] } as RequestUser,
      {},
    );

    expect(result.status).toBe(TrainerBookingStatus.CANCELLED);
  });

  it('requires a reason when a trainer cancels a confirmed booking', async () => {
    repository.findById.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.CONFIRMED,
      trainerId,
      startAt: new Date('2030-01-10T09:00:00.000Z'),
    });

    await expect(
      service.cancel(
        'booking-1',
        { sub: trainerId, roles: [ERoleName.TRAINER] } as RequestUser,
        {},
      ),
    ).rejects.toThrow(/cancellation reason is required/i);
  });

  it('prevents admin cancellation of historical bookings', async () => {
    repository.findById.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.COMPLETED,
    });

    await expect(
      service.cancel(
        'booking-1',
        { sub: 'admin-1', roles: [ERoleName.ADMIN] } as RequestUser,
        { reason: 'Administrative action' },
      ),
    ).rejects.toThrow(/historical bookings cannot be cancelled/i);
  });

  it('allows trainer rejection to be idempotent and skips a second update', async () => {
    repository.findById.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.REJECTED,
    });

    const result = await service.reject(
      'booking-1',
      trainerId,
      {} as TrainerBookingActionDto,
    );

    expect(result.status).toBe(TrainerBookingStatus.REJECTED);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('runs lazy expiry before trainer accept and uses canonical overlap helpers', async () => {
    const tx = createTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    repository.findRawById.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.PENDING_REVIEW,
    });
    repository.update.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
    });

    const result = await service.accept('booking-1', trainerId);

    expect(repository.expirePendingReview).toHaveBeenCalled();
    expect(repository.expirePendingPayment).toHaveBeenCalled();
    expect(repository.findBlockingOverlapForTrainer).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        excludeBookingId: booking.id,
      }),
      tx,
    );
    expect(repository.findBlockingOverlapForMember).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        excludeBookingId: booking.id,
      }),
      tx,
    );
    expect(result.status).toBe(TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT);
  });

  it('confirms accepted bookings from payment and is idempotent on repeated success', async () => {
    repository.findById
      .mockResolvedValueOnce({
        ...booking,
        status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
      })
      .mockResolvedValueOnce({
        ...booking,
        status: TrainerBookingStatus.CONFIRMED,
      });
    repository.update.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.CONFIRMED,
    });

    const first = await service.confirmByPayment('booking-1', 'payment-1');
    const second = await service.confirmByPayment('booking-1', 'payment-1');

    expect(first.status).toBe(TrainerBookingStatus.CONFIRMED);
    expect(second.status).toBe(TrainerBookingStatus.CONFIRMED);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it('marks payment failure once and skips repeated failed events', async () => {
    repository.findById
      .mockResolvedValueOnce({
        ...booking,
        status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
      })
      .mockResolvedValueOnce({
        ...booking,
        status: TrainerBookingStatus.PAYMENT_FAILED,
      });
    repository.update.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.PAYMENT_FAILED,
    });

    const first = await service.failByPayment('booking-1', 'payment-1', 'PAYMENT_FAILED');
    const second = await service.failByPayment('booking-1', 'payment-1', 'PAYMENT_FAILED');

    expect(first?.status).toBe(TrainerBookingStatus.PAYMENT_FAILED);
    expect(second).toBeNull();
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it('marks session-expired payments as expired and skips repeated expiry events', async () => {
    repository.findById
      .mockResolvedValueOnce({
        ...booking,
        status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
      })
      .mockResolvedValueOnce({
        ...booking,
        status: TrainerBookingStatus.EXPIRED,
      });
    repository.update.mockResolvedValue({
      ...booking,
      status: TrainerBookingStatus.EXPIRED,
    });

    const first = await service.expireByPaymentTimeout(
      'booking-1',
      'payment-1',
      'SESSION_EXPIRED',
    );
    const second = await service.expireByPaymentTimeout(
      'booking-1',
      'payment-1',
      'SESSION_EXPIRED',
    );

    expect(first?.status).toBe(TrainerBookingStatus.EXPIRED);
    expect(second).toBeNull();
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it('runs expiry sweeps through the repository helpers', async () => {
    repository.expirePendingReview.mockResolvedValue(2);
    repository.expirePendingPayment.mockResolvedValue(3);

    await expect(service.expireStaleBookings()).resolves.toBe(5);
    expect(repository.expirePendingReview).toHaveBeenCalled();
    expect(repository.expirePendingPayment).toHaveBeenCalled();
  });

  it('reports messaging eligibility from recent confirmed or completed bookings', async () => {
    prisma.trainerBooking.findFirst.mockResolvedValue({
      id: 'booking-2',
      memberId,
      trainerId,
      status: TrainerBookingStatus.CONFIRMED,
      endAt: new Date('2030-01-15T10:00:00.000Z'),
    });

    await expect(
      service.isMessagingEligible(memberId, trainerId),
    ).resolves.toBe(true);
  });

  it('reports messaging eligibility from a completed booking inside the 30-day window', async () => {
    prisma.trainerBooking.findFirst.mockResolvedValue({
      id: 'booking-3',
      memberId,
      trainerId,
      status: TrainerBookingStatus.COMPLETED,
      endAt: new Date('2029-12-20T10:00:00.000Z'),
    });

    await expect(
      service.isMessagingEligible(memberId, trainerId),
    ).resolves.toBe(true);
  });

  it('rejects access when there is only stale history', async () => {
    prisma.trainerBooking.findFirst.mockResolvedValue(null);

    await expect(
      service.isMessagingEligible(memberId, trainerId),
    ).resolves.toBe(false);
  });

  it('rejects messaging eligibility when history is cancelled only', async () => {
    prisma.trainerBooking.findFirst.mockResolvedValue(null);

    await expect(
      service.isMessagingEligible(memberId, trainerId),
    ).resolves.toBe(false);
  });

  it('rejects messaging eligibility when history is payment failed or expired only', async () => {
    prisma.trainerBooking.findFirst.mockResolvedValue(null);

    await expect(
      service.isMessagingEligible(memberId, trainerId),
    ).resolves.toBe(false);
  });

  it('sends reminder notifications only for confirmed bookings inside the reminder window', async () => {
    prisma.trainerBooking.findMany.mockResolvedValue([
      {
        ...booking,
        status: TrainerBookingStatus.CONFIRMED,
        startAt: new Date('2030-01-02T06:00:00.000Z'),
      },
    ]);

    const result = await service.sendUpcomingReminders(now);

    expect(result).toBe(2);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: 'Upcoming trainer session reminder',
        type: NotificationType.BOOKING,
        referenceId: booking.id,
      }),
    );
  });
});
