import { Test, TestingModule } from '@nestjs/testing';
import { ClassScheduleController } from './class-schedule.controller';
import { ClassScheduleService } from './class-schedule.service';
import { DayOfWeekDto } from './dto/create-class-schedule.dto';

describe('ClassScheduleController', () => {
  let controller: ClassScheduleController;
  let service: jest.Mocked<Pick<ClassScheduleService, 'findAll' | 'findOne'>>;

  const baseSchedule = {
    id: 'schedule-1',
    classId: 'class-1',
    trainerId: 'trainer-1',
    dayOfWeek: DayOfWeekDto.MON,
    scheduleDays: [
      { id: 'sd-1', scheduleId: 'schedule-1', dayOfWeek: DayOfWeekDto.MON },
    ],
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
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClassScheduleController],
      providers: [{ provide: ClassScheduleService, useValue: service }],
    }).compile();

    controller = module.get<ClassScheduleController>(ClassScheduleController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('normalizes list date to UTC noon and exposes the occurrence payload', async () => {
    const targetDate = new Date('2030-01-06T12:00:00Z');
    service.findAll.mockResolvedValue({
      docs: [
        {
          ...baseSchedule,
          bookingsCount: 3,
          occurrence: {
            date: targetDate,
            status: 'cancelled',
            effectiveStartTime: baseSchedule.startTime,
            effectiveEndTime: baseSchedule.endTime,
            isBookable: false,
            currentBookings: 3,
            remainingSlots: 0,
            exception: {
              id: 'exception-1',
              scheduleId: 'schedule-1',
              exceptionDate: new Date('2030-01-06T00:00:00Z'),
              type: 'CANCELLED',
              reason: 'Holiday',
              newStartTime: null,
              newEndTime: null,
              createdAt: new Date('2030-01-01T00:00:00Z'),
              updatedAt: new Date('2030-01-01T00:00:00Z'),
            },
          },
        } as any,
      ],
      docsCount: 1,
      totalDocs: 1,
      totalPages: 1,
      currentPage: 1,
      nextPage: null,
      previousPage: null,
      limit: 10,
      hasNext: false,
      hasPrev: false,
    } as any);

    const result = await controller.list({ date: '2030-01-06' } as any);

    expect(service.findAll).toHaveBeenCalledWith(
      {
        page: 1,
        limit: 10,
        sort: 'asc',
        sortBy: 'createdAt',
      },
      {
        q: undefined,
        searchField: undefined,
        dayOfWeek: undefined,
        trainerId: undefined,
        classId: undefined,
        isActive: undefined,
      },
      { counted: true },
      targetDate,
    );
    expect(result.data.docs[0]).toEqual(
      expect.objectContaining({
        currentBookings: 3,
        remainingSlots: 0,
        occurrence: expect.objectContaining({
          date: '2030-01-06',
          status: 'cancelled',
          isBookable: false,
        }),
      }),
    );
  });

  it('normalizes detail date to UTC noon before calling the service', async () => {
    service.findOne.mockResolvedValue(baseSchedule as any);

    await controller.findOne('schedule-1', '2030-01-06');

    expect(service.findOne).toHaveBeenCalledWith(
      'schedule-1',
      new Date('2030-01-06T12:00:00Z'),
    );
  });

  it('omits occurrence from detail responses when no date is supplied', async () => {
    service.findOne.mockResolvedValue(baseSchedule as any);

    const result = await controller.findOne('schedule-1');

    expect(result.data.occurrence).toBeUndefined();
  });
});
