import { DayOfWeek, ExceptionType } from '@prisma/client';
import { ChatbotMemberDataFacade } from './chatbot-member-data.facade';

describe('ChatbotMemberDataFacade', () => {
  let facade: ChatbotMemberDataFacade;
  let classScheduleService: { findAll: jest.Mock };
  let classBookingService: { findByUserId: jest.Mock };
  let membershipsService: { findMyMembership: jest.Mock };

  const baseSchedule = {
    id: 'schedule-1',
    classId: 'class-1',
    trainerId: 'trainer-1',
    dayOfWeek: DayOfWeek.MON,
    scheduleDays: [
      {
        id: 'sd-1',
        scheduleId: 'schedule-1',
        dayOfWeek: DayOfWeek.MON,
      },
    ],
    startTime: new Date('2030-01-01T09:00:00Z'),
    endTime: new Date('2030-01-01T10:00:00Z'),
    validFrom: null,
    validUntil: null,
    location: 'Studio A',
    capacity: 20,
    isActive: true,
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

  beforeEach(() => {
    classScheduleService = {
      findAll: jest.fn(),
    };
    classBookingService = {
      findByUserId: jest.fn(),
    };
    membershipsService = {
      findMyMembership: jest.fn(),
    };

    facade = new ChatbotMemberDataFacade(
      classScheduleService as any,
      classBookingService as any,
      membershipsService as any,
    );
  });

  it('uses occurrence effective times and labels rescheduled schedules', async () => {
    classScheduleService.findAll.mockResolvedValue({
      docs: [
        {
          ...baseSchedule,
          occurrence: {
            date: new Date('2030-01-06T12:00:00Z'),
            status: 'rescheduled',
            effectiveStartTime: new Date('1970-01-01T11:00:00Z'),
            effectiveEndTime: new Date('1970-01-01T12:00:00Z'),
            isBookable: true,
            currentBookings: 4,
            remainingSlots: 16,
            exception: {
              id: 'exception-1',
              scheduleId: 'schedule-1',
              exceptionDate: new Date('2030-01-06T00:00:00Z'),
              type: ExceptionType.RESCHEDULED,
              reason: 'Trainer moved later',
              newStartTime: new Date('1970-01-01T11:00:00Z'),
              newEndTime: new Date('1970-01-01T12:00:00Z'),
              createdAt: new Date('2030-01-01T00:00:00Z'),
              updatedAt: new Date('2030-01-01T00:00:00Z'),
            },
          },
        },
      ],
    });

    const result = await facade.getScheduleAnswer({ date: '2030-01-06' });

    expect(classScheduleService.findAll).toHaveBeenCalledWith(
      {
        page: 1,
        limit: 5,
        sort: 'asc',
        sortBy: 'createdAt',
      },
      {
        q: undefined,
        searchField: undefined,
        dayOfWeek: undefined,
        isActive: true,
      },
      { counted: true },
      new Date('2030-01-06T12:00:00Z'),
    );
    expect(result.text).toContain('11:00-12:00');
    expect(result.text).toContain('[rescheduled on 2030-01-06]');
  });

  it('labels cancelled schedules in chatbot schedule answers', async () => {
    classScheduleService.findAll.mockResolvedValue({
      docs: [
        {
          ...baseSchedule,
          occurrence: {
            date: new Date('2030-01-06T12:00:00Z'),
            status: 'cancelled',
            effectiveStartTime: baseSchedule.startTime,
            effectiveEndTime: baseSchedule.endTime,
            isBookable: false,
            currentBookings: 2,
            remainingSlots: 0,
            exception: {
              id: 'exception-2',
              scheduleId: 'schedule-1',
              exceptionDate: new Date('2030-01-06T00:00:00Z'),
              type: ExceptionType.CANCELLED,
              reason: 'Holiday',
              newStartTime: null,
              newEndTime: null,
              createdAt: new Date('2030-01-01T00:00:00Z'),
              updatedAt: new Date('2030-01-01T00:00:00Z'),
            },
          },
        },
      ],
    });

    const result = await facade.getScheduleAnswer({ date: '2030-01-06' });

    expect(result.text).toContain('[cancelled on 2030-01-06]');
    expect(result.text).toContain('09:00-10:00');
  });
});
