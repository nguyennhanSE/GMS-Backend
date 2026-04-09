import { DayOfWeek, ExceptionType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ClassScheduleRepository } from './class-schedule.repository';

describe('ClassScheduleRepository', () => {
  let repository: ClassScheduleRepository;
  let prisma: {
    classSchedule: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    classBooking: {
      count: jest.Mock;
      groupBy: jest.Mock;
    };
  };

  const baseSchedule = {
    id: 'schedule-1',
    classId: 'class-1',
    trainerId: 'trainer-1',
    dayOfWeek: DayOfWeek.MON,
    startTime: new Date('2030-01-01T09:00:00Z'),
    endTime: new Date('2030-01-01T10:00:00Z'),
    validFrom: null,
    validUntil: null,
    location: 'Studio A',
    capacity: 20,
    isActive: true,
    createdAt: new Date('2030-01-01T00:00:00Z'),
    updatedAt: new Date('2030-01-01T00:00:00Z'),
    gymClass: {
      id: 'class-1',
      className: 'Morning Yoga',
      description: 'Relaxing class',
      difficultyLevel: 'Beginner',
      category: 'Yoga',
      isActive: true,
      createdAt: new Date('2030-01-01T00:00:00Z'),
      updatedAt: new Date('2030-01-01T00:00:00Z'),
    },
    scheduleDays: [
      {
        id: 'sd-1',
        scheduleId: 'schedule-1',
        dayOfWeek: DayOfWeek.MON,
        createdAt: new Date('2030-01-01T00:00:00Z'),
      },
    ],
  };

  beforeEach(() => {
    prisma = {
      classSchedule: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      classBooking: {
        count: jest.fn(),
        groupBy: jest.fn(),
      },
    };

    repository = new ClassScheduleRepository(prisma as unknown as PrismaService);
  });

  it('builds a cancelled occurrence for date-aware detail requests', async () => {
    const targetDate = new Date('2030-01-06T12:00:00Z');
    prisma.classSchedule.findUnique.mockResolvedValue({
      ...baseSchedule,
      scheduleExceptions: [
        {
          id: 'exception-1',
          scheduleId: 'schedule-1',
          exceptionDate: new Date('2030-01-06T00:00:00Z'),
          type: ExceptionType.CANCELLED,
          reason: 'Holiday',
          newStartTime: null,
          newEndTime: null,
          createdAt: new Date('2030-01-01T00:00:00Z'),
          updatedAt: new Date('2030-01-01T00:00:00Z'),
        },
      ],
    });
    prisma.classBooking.count.mockResolvedValue(3);

    const result = await repository.getById('schedule-1', targetDate);

    expect(prisma.classSchedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          scheduleExceptions: expect.objectContaining({
            where: {
              exceptionDate: new Date('2030-01-06T00:00:00Z'),
            },
          }),
        }),
      }),
    );
    expect(result?.occurrence).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        isBookable: false,
        currentBookings: 3,
        remainingSlots: 0,
      }),
    );
    expect(result?.occurrence?.date).toEqual(targetDate);
  });

  it('builds a rescheduled occurrence for date-aware list requests', async () => {
    const targetDate = new Date('2030-01-06T12:00:00Z');
    prisma.classSchedule.findMany.mockResolvedValue([
      {
        ...baseSchedule,
        scheduleExceptions: [
          {
            id: 'exception-2',
            scheduleId: 'schedule-1',
            exceptionDate: new Date('2030-01-06T00:00:00Z'),
            type: ExceptionType.RESCHEDULED,
            reason: 'Trainer moved later',
            newStartTime: new Date('1970-01-01T11:00:00Z'),
            newEndTime: new Date('1970-01-01T12:00:00Z'),
            createdAt: new Date('2030-01-01T00:00:00Z'),
            updatedAt: new Date('2030-01-01T00:00:00Z'),
          },
        ],
      },
    ]);
    prisma.classSchedule.count.mockResolvedValue(1);
    prisma.classBooking.groupBy.mockResolvedValue([
      {
        classScheduleId: 'schedule-1',
        _count: { id: 4 },
      },
    ]);

    const result = await repository.getPaginate(
      {},
      { page: 1, limit: 10, sort: 'asc', sortBy: 'createdAt', counted: true },
      targetDate,
    );

    expect(result.docs[0].occurrence).toEqual(
      expect.objectContaining({
        status: 'rescheduled',
        isBookable: true,
        currentBookings: 4,
        remainingSlots: 16,
        effectiveStartTime: new Date('1970-01-01T11:00:00Z'),
        effectiveEndTime: new Date('1970-01-01T12:00:00Z'),
      }),
    );
    expect(prisma.classBooking.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingStartDate: { lte: targetDate },
          bookingEndDate: { gte: targetDate },
        }),
      }),
    );
  });
});
