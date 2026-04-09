import { ExceptionType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ScheduleExceptionRepository } from './schedule-exception.repository';

describe('ScheduleExceptionRepository', () => {
  let repository: ScheduleExceptionRepository;
  let prisma: {
    scheduleException: {
      create: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      scheduleException: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    repository = new ScheduleExceptionRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('normalizes exception dates to UTC day start when creating records', async () => {
    const normalizedDate = new Date('2030-01-06T00:00:00Z');
    prisma.scheduleException.create.mockResolvedValue({
      id: 'exception-1',
      scheduleId: 'schedule-1',
      exceptionDate: normalizedDate,
      type: ExceptionType.CANCELLED,
      reason: 'Holiday',
      newStartTime: null,
      newEndTime: null,
      createdAt: new Date('2030-01-01T00:00:00Z'),
      updatedAt: new Date('2030-01-01T00:00:00Z'),
    });

    await repository.create({
      scheduleId: 'schedule-1',
      exceptionDate: new Date('2030-01-06T12:00:00Z'),
      type: ExceptionType.CANCELLED,
      reason: 'Holiday',
    });

    expect(prisma.scheduleException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exceptionDate: normalizedDate,
      }),
    });
  });

  it('normalizes lookup dates to UTC day start for exact exception matches', async () => {
    prisma.scheduleException.findUnique.mockResolvedValue(null);

    await repository.findByScheduleIdAndDate(
      'schedule-1',
      new Date('2030-01-06T12:00:00Z'),
    );

    expect(prisma.scheduleException.findUnique).toHaveBeenCalledWith({
      where: {
        scheduleId_exceptionDate: {
          scheduleId: 'schedule-1',
          exceptionDate: new Date('2030-01-06T00:00:00Z'),
        },
      },
    });
  });
});
