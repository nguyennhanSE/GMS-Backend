import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ScheduleExceptionService } from './schedule-exception.service';
import { ScheduleExceptionRepository } from './repositories/schedule-exception.repository';
import { ClassScheduleRepository } from './repositories/class-schedule.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NOTIFICATION_EVENTS } from '../../common/events/notification.events';

describe('ScheduleExceptionService', () => {
  let service: ScheduleExceptionService;
  let exceptionRepository: jest.Mocked<any>;
  let scheduleRepository: jest.Mocked<any>;
  let prisma: jest.Mocked<any>;
  let eventEmitter: jest.Mocked<any>;

  beforeEach(async () => {
    exceptionRepository = {
      findByScheduleIdAndDate: jest.fn(),
      create: jest.fn(),
      findByScheduleId: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      isCancelled: jest.fn(),
    };

    scheduleRepository = {
      getById: jest.fn(),
    };

    prisma = {
      classBooking: {
        findMany: jest.fn(),
      },
    };

    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleExceptionService,
        { provide: ScheduleExceptionRepository, useValue: exceptionRepository },
        { provide: ClassScheduleRepository, useValue: scheduleRepository },
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(ScheduleExceptionService);
  });

  it('emits class-cancelled notifications for affected bookings when a cancellation is created', async () => {
    scheduleRepository.getById.mockResolvedValue({
      id: 'schedule-1',
      gymClass: { className: 'Sunrise Yoga' },
    });
    exceptionRepository.findByScheduleIdAndDate.mockResolvedValue(null);
    exceptionRepository.create.mockResolvedValue({ id: 'exception-1' });
    prisma.classBooking.findMany.mockResolvedValue([
      {
        id: 'booking-1',
        user: {
          id: 'user-1',
          email: 'member@test.local',
          firstName: 'Test',
          lastName: 'Member',
        },
      },
      {
        id: 'booking-2',
        user: null,
      },
    ]);

    await service.create('schedule-1', {
      exceptionDate: '2026-03-22',
      type: 'CANCELLED',
      reason: 'Trainer unavailable',
    });

    expect(prisma.classBooking.findMany).toHaveBeenCalledWith({
      where: {
        classScheduleId: 'schedule-1',
        status: { not: 'cancelled' },
        bookingStartDate: { lte: new Date('2026-03-22') },
        bookingEndDate: { gte: new Date('2026-03-22') },
      },
      include: { user: true },
    });
    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.CLASS_CANCELLED,
      expect.objectContaining({
        userId: 'user-1',
        title: 'Class cancelled',
        referenceId: 'booking-1',
      }),
    );
  });

  it('does not emit notifications for rescheduled exceptions', async () => {
    scheduleRepository.getById.mockResolvedValue({
      id: 'schedule-1',
      gymClass: { className: 'Sunrise Yoga' },
    });
    exceptionRepository.findByScheduleIdAndDate.mockResolvedValue(null);
    exceptionRepository.create.mockResolvedValue({ id: 'exception-1' });

    await service.create('schedule-1', {
      exceptionDate: '2026-03-22',
      type: 'RESCHEDULED',
      newStartTime: '09:00:00',
      newEndTime: '10:00:00',
    });

    expect(prisma.classBooking.findMany).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});
