import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ScheduleExceptionService } from './schedule-exception.service';
import { ScheduleExceptionRepository } from './repositories/schedule-exception.repository';
import { ClassScheduleRepository } from './repositories/class-schedule.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NOTIFICATION_EVENTS } from '../../common/events/notification.events';
import { ExceptionTypeDto } from './dto/schedule-exception.dto';
import { AppCacheService } from '../../libs/cache/cache.service';

describe('ScheduleExceptionService', () => {
  let service: ScheduleExceptionService;
  let exceptionRepository: jest.Mocked<any>;
  let scheduleRepository: jest.Mocked<any>;
  let prisma: jest.Mocked<any>;
  let eventEmitter: jest.Mocked<any>;
  let appCacheService: jest.Mocked<Pick<AppCacheService, 'invalidateTags'>>;

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

    appCacheService = {
      invalidateTags: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleExceptionService,
        { provide: ScheduleExceptionRepository, useValue: exceptionRepository },
        { provide: ClassScheduleRepository, useValue: scheduleRepository },
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AppCacheService, useValue: appCacheService },
      ],
    }).compile();

    service = module.get(ScheduleExceptionService);
  });

  it('emits class-cancelled notifications for affected bookings when a cancellation is created', async () => {
    scheduleRepository.getById.mockResolvedValue({
      id: 'schedule-1',
      trainerId: 'trainer-1',
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
      type: ExceptionTypeDto.CANCELLED,
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
    expect(appCacheService.invalidateTags).toHaveBeenCalledWith(
      expect.arrayContaining([
        'class-schedule:list',
        'class-schedule:id:schedule-1',
        'trainer:availability:trainer-1',
      ]),
    );
  });

  it('does not emit notifications for rescheduled exceptions', async () => {
    scheduleRepository.getById.mockResolvedValue({
      id: 'schedule-1',
      trainerId: 'trainer-1',
      gymClass: { className: 'Sunrise Yoga' },
    });
    exceptionRepository.findByScheduleIdAndDate.mockResolvedValue(null);
    exceptionRepository.create.mockResolvedValue({ id: 'exception-1' });

    await service.create('schedule-1', {
      exceptionDate: '2026-03-22',
      type: ExceptionTypeDto.RESCHEDULED,
      newStartTime: '09:00:00',
      newEndTime: '10:00:00',
    });

    expect(prisma.classBooking.findMany).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    expect(appCacheService.invalidateTags).toHaveBeenCalledWith(
      expect.arrayContaining([
        'class-schedule:id:schedule-1',
        'trainer:availability:trainer-1',
      ]),
    );
  });

  it('invalidates schedule and trainer availability tags when updating an exception', async () => {
    exceptionRepository.findById.mockResolvedValue({
      id: 'exception-1',
      scheduleId: 'schedule-1',
      type: ExceptionTypeDto.CANCELLED,
      newStartTime: null,
      newEndTime: null,
    });
    scheduleRepository.getById.mockResolvedValue({
      id: 'schedule-1',
      trainerId: 'trainer-1',
      gymClass: { className: 'Sunrise Yoga' },
    });
    exceptionRepository.update.mockResolvedValue({ id: 'exception-1' });

    await service.update('exception-1', {
      type: ExceptionTypeDto.RESCHEDULED,
      newStartTime: '09:00:00',
      newEndTime: '10:00:00',
    });

    expect(appCacheService.invalidateTags).toHaveBeenCalledWith(
      expect.arrayContaining([
        'class-schedule:id:schedule-1',
        'trainer:availability:trainer-1',
      ]),
    );
  });

  it('invalidates schedule and trainer availability tags when removing an exception', async () => {
    exceptionRepository.findById.mockResolvedValue({
      id: 'exception-1',
      scheduleId: 'schedule-1',
    });
    scheduleRepository.getById.mockResolvedValue({
      id: 'schedule-1',
      trainerId: 'trainer-1',
    });
    exceptionRepository.delete.mockResolvedValue(undefined);

    await service.remove('exception-1');

    expect(exceptionRepository.delete).toHaveBeenCalledWith('exception-1');
    expect(appCacheService.invalidateTags).toHaveBeenCalledWith(
      expect.arrayContaining([
        'class-schedule:id:schedule-1',
        'trainer:availability:trainer-1',
      ]),
    );
  });
});
