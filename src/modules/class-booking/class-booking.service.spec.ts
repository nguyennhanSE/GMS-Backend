import { Test, TestingModule } from '@nestjs/testing';
import { ClassBookingService } from './class-booking.service';
import { ClassBookingRepository } from './repositories/class-booking.repository';
import { ClassScheduleService } from '../class-schedule/class-schedule.service';
import { ScheduleExceptionService } from '../class-schedule/schedule-exception.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';
import { AppCacheService } from '../../libs/cache/cache.service';

describe('ClassBookingService', () => {
  let service: ClassBookingService;
  let prismaService: jest.Mocked<PrismaService>;
  let classBookingRepository: jest.Mocked<ClassBookingRepository>;
  let appCacheService: jest.Mocked<Pick<AppCacheService, 'invalidateTags'>>;
  let updateBooking: jest.Mock;
  let getBookingsByUserId: jest.Mock;
  let getBookingsByClassScheduleId: jest.Mock;
  let deleteBooking: jest.Mock;
  let invalidateCacheTags: jest.Mock;

  // Mock schedule with new schema structure
  const mockSchedule = {
    id: 'schedule-1',
    classId: 'class-1',
    trainerId: 'trainer-1',
    dayOfWeek: 'MON',
    startTime: new Date('2030-01-01T10:00:00Z'),
    endTime: new Date('2030-01-01T11:00:00Z'),
    validFrom: null,
    validUntil: null,
    location: 'Studio A',
    capacity: 20,
    isActive: true,
    gymClass: {
      id: 'class-1',
      className: 'Morning Yoga',
      description: 'Relaxing yoga class',
      difficultyLevel: 'Beginner',
      category: 'Yoga',
      isActive: true,
    },
  };

  const mockBooking = {
    id: 'booking-1',
    userId: 'user-1',
    classScheduleId: 'schedule-1',
    bookingStartDate: new Date('2030-01-07'),
    bookingEndDate: new Date('2030-01-14'),
    status: 'pending',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    updateBooking = jest.fn();
    getBookingsByUserId = jest.fn();
    getBookingsByClassScheduleId = jest.fn();
    deleteBooking = jest.fn();
    invalidateCacheTags = jest.fn();

    appCacheService = {
      invalidateTags: invalidateCacheTags,
    };

    const mockPrismaService = {
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
      classSchedule: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      classBooking: {
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      trainerAvailability: {
        findMany: jest.fn(),
      },
    };

    const mockRepository = {
      getPaginate: jest.fn(),
      getById: jest.fn(),
      getByUserId: getBookingsByUserId,
      getByClassScheduleId: getBookingsByClassScheduleId,
      update: updateBooking,
      delete: deleteBooking,
    };

    const mockClassScheduleService = {
      findOne: jest.fn(),
    };

    const mockScheduleExceptionService = {
      getExceptionForDate: jest.fn().mockResolvedValue(null),
      isClassCancelledOnDate: jest.fn().mockResolvedValue(false),
    };

    const mockPaymentService = {
      createCheckout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassBookingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ClassBookingRepository, useValue: mockRepository },
        { provide: ClassScheduleService, useValue: mockClassScheduleService },
        {
          provide: ScheduleExceptionService,
          useValue: mockScheduleExceptionService,
        },
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: AppCacheService, useValue: appCacheService },
      ],
    }).compile();

    service = module.get<ClassBookingService>(ClassBookingService);
    prismaService = module.get(PrismaService);
    classBookingRepository = module.get(ClassBookingRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw BadRequestException when schedule is not active', async () => {
      const inactiveSchedule = { ...mockSchedule, isActive: false };

      prismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn(),
          classSchedule: {
            findUnique: jest.fn().mockResolvedValue(inactiveSchedule),
          },
          classBooking: {
            findFirst: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
          },
          trainerAvailability: {
            findMany: jest.fn(),
          },
        };
        return callback(mockTx as any);
      });

      await expect(
        service.create({
          classScheduleId: ['schedule-1'],
          userId: 'user-1',
          bookingStartDate: new Date('2030-01-07'),
          bookingEndDate: new Date('2030-01-14'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user tries to book their own class', async () => {
      const trainerSchedule = { ...mockSchedule, trainerId: 'user-1' };

      prismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn(),
          classSchedule: {
            findUnique: jest.fn().mockResolvedValue(trainerSchedule),
          },
          classBooking: {
            findFirst: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
          },
          trainerAvailability: {
            findMany: jest.fn(),
          },
        };
        return callback(mockTx as any);
      });

      await expect(
        service.create({
          classScheduleId: ['schedule-1'],
          userId: 'user-1',
          bookingStartDate: new Date('2030-01-07'),
          bookingEndDate: new Date('2030-01-14'),
        }),
      ).rejects.toThrow('Trainers cannot book their own classes');
    });

    it('should throw BadRequestException when duplicate booking exists', async () => {
      prismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn(),
          classSchedule: {
            findUnique: jest.fn().mockResolvedValue(mockSchedule),
          },
          classBooking: {
            findFirst: jest.fn().mockResolvedValue(mockBooking), // Existing booking
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(),
            findMany: jest.fn(),
          },
          trainerAvailability: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        return callback(mockTx as any);
      });

      await expect(
        service.create({
          classScheduleId: ['schedule-1'],
          userId: 'user-1',
          bookingStartDate: new Date('2030-01-07'),
          bookingEndDate: new Date('2030-01-14'),
        }),
      ).rejects.toThrow('User already has an active booking');
    });

    it('should throw BadRequestException when class is full', async () => {
      prismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn(),
          classSchedule: {
            findUnique: jest.fn().mockResolvedValue(mockSchedule),
          },
          classBooking: {
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(20), // At capacity
            create: jest.fn(),
            findMany: jest.fn(),
          },
          trainerAvailability: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        return callback(mockTx as any);
      });

      await expect(
        service.create({
          classScheduleId: ['schedule-1'],
          userId: 'user-1',
          bookingStartDate: new Date('2030-01-07'),
          bookingEndDate: new Date('2030-01-14'),
        }),
      ).rejects.toThrow(/is full/);
    });

    it('should throw NotFoundException when schedule does not exist', async () => {
      prismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn(),
          classSchedule: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          classBooking: {
            findFirst: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
          },
          trainerAvailability: {
            findMany: jest.fn(),
          },
        };
        return callback(mockTx as any);
      });

      await expect(
        service.create({
          classScheduleId: ['non-existent'],
          userId: 'user-1',
          bookingStartDate: new Date('2030-01-01'),
          bookingEndDate: new Date('2030-01-14'),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when booking date does not match schedule dayOfWeek', async () => {
      // Schedule is MON, but booking date is a Tuesday
      const mondaySchedule = { ...mockSchedule, dayOfWeek: 'MON' };

      prismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn(),
          classSchedule: {
            findUnique: jest.fn().mockResolvedValue(mondaySchedule),
          },
          classBooking: {
            findFirst: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
          },
          trainerAvailability: {
            findMany: jest.fn(),
          },
        };
        return callback(mockTx as any);
      });

      // 2030-01-08 is a Tuesday (UTC)
      await expect(
        service.create({
          classScheduleId: ['schedule-1'],
          userId: 'user-1',
          bookingStartDate: new Date('2030-01-08'),
          bookingEndDate: new Date('2030-01-15'),
        }),
      ).rejects.toThrow(/is scheduled for MON only/);
    });

    it('should pass day-of-week validation when booking date matches schedule dayOfWeek', async () => {
      // Schedule is MON, booking date is a Monday
      const mondaySchedule = { ...mockSchedule, dayOfWeek: 'MON' };

      prismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn(),
          classSchedule: {
            findUnique: jest.fn().mockResolvedValue(mondaySchedule),
          },
          classBooking: {
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
            upsert: jest.fn().mockResolvedValue({
              id: 'new-booking',
              userId: 'user-1',
              classScheduleId: 'schedule-1',
              bookingStartDate: new Date('2030-01-07'),
              bookingEndDate: new Date('2030-01-14'),
              status: 'pending',
            }),
            findMany: jest.fn(),
          },
          trainerAvailability: {
            findMany: jest.fn().mockResolvedValue([
              {
                trainerId: 'trainer-1',
                isAvailable: true,
                startTime: new Date('2030-01-01T08:00:00Z'),
                endTime: new Date('2030-01-01T12:00:00Z'),
              },
            ]),
          },
        };
        return callback(mockTx as any);
      });
      (prismaService.classBooking.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'new-booking',
          userId: 'user-1',
          classScheduleId: 'schedule-1',
          bookingStartDate: new Date('2030-01-07'),
          bookingEndDate: new Date('2030-01-14'),
          status: 'pending',
          user: null,
          classSchedule: null,
        },
      ] as any);
      (prismaService.classSchedule.findMany as jest.Mock).mockResolvedValue([
        { id: 'schedule-1', trainerId: 'trainer-1' },
      ] as any);

      // 2030-01-07 is a Monday (UTC)
      const result = await service.create({
        classScheduleId: ['schedule-1'],
        userId: 'user-1',
        bookingStartDate: new Date('2030-01-07'),
        bookingEndDate: new Date('2030-01-14'),
      });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
      expect(prismaService.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          isolationLevel: 'Serializable',
          timeout: 20000,
        }),
      );
      expect(invalidateCacheTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'class-schedule:id:schedule-1',
          'class-schedule:trainer:trainer-1',
          'trainer:availability:trainer-1',
        ]),
      );
    });

    it('should retry transient serializable conflicts before succeeding', async () => {
      const mondaySchedule = { ...mockSchedule, dayOfWeek: 'MON' };
      const successfulBooking = {
        id: 'new-booking',
        userId: 'user-1',
        classScheduleId: 'schedule-1',
        bookingStartDate: new Date('2030-01-07'),
        bookingEndDate: new Date('2030-01-14'),
        status: 'pending',
      };

      prismaService.$transaction
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockImplementationOnce(async (callback) => {
          const mockTx = {
            $queryRaw: jest.fn(),
            classSchedule: {
              findUnique: jest.fn().mockResolvedValue(mondaySchedule),
            },
            classBooking: {
              findFirst: jest.fn().mockResolvedValue(null),
              count: jest.fn().mockResolvedValue(0),
              upsert: jest.fn().mockResolvedValue(successfulBooking),
              findMany: jest.fn(),
            },
            trainerAvailability: {
              findMany: jest.fn().mockResolvedValue([
                {
                  trainerId: 'trainer-1',
                  isAvailable: true,
                  startTime: new Date('2030-01-01T08:00:00Z'),
                  endTime: new Date('2030-01-01T12:00:00Z'),
                },
              ]),
            },
          };

          return callback(mockTx as any);
        });

      (prismaService.classBooking.findMany as jest.Mock).mockResolvedValue([
        {
          ...successfulBooking,
          user: null,
          classSchedule: null,
        },
      ] as any);
      (prismaService.classSchedule.findMany as jest.Mock).mockResolvedValue([
        { id: 'schedule-1', trainerId: 'trainer-1' },
      ] as any);

      const result = await service.create({
        classScheduleId: ['schedule-1'],
        userId: 'user-1',
        bookingStartDate: new Date('2030-01-07'),
        bookingEndDate: new Date('2030-01-14'),
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('new-booking');
      expect(prismaService.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('findOne', () => {
    it('should return booking when found', async () => {
      classBookingRepository.getById.mockResolvedValue(mockBooking as any);

      const result = await service.findOne('booking-1');

      expect(result).toEqual(mockBooking);
    });

    it('should throw NotFoundException when booking not found', async () => {
      classBookingRepository.getById.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('should allow user to cancel their own booking', async () => {
      classBookingRepository.getById.mockResolvedValue(mockBooking as any);
      classBookingRepository.update.mockResolvedValue({
        ...mockBooking,
        status: 'cancelled',
      } as any);
      (prismaService.classSchedule.findMany as jest.Mock).mockResolvedValue([
        { id: 'schedule-1', trainerId: 'trainer-1' },
      ] as any);

      const result = await service.cancel('booking-1', 'user-1', false);

      expect(result.status).toBe('cancelled');
      expect(updateBooking).toHaveBeenCalledWith('booking-1', {
        status: 'cancelled',
      });
      expect(invalidateCacheTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'class-schedule:id:schedule-1',
          'trainer:availability:trainer-1',
        ]),
      );
    });

    it('should throw ForbiddenException when non-owner tries to cancel', async () => {
      classBookingRepository.getById.mockResolvedValue(mockBooking as any);

      await expect(
        service.cancel('booking-1', 'other-user', false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to cancel any booking', async () => {
      classBookingRepository.getById.mockResolvedValue(mockBooking as any);
      classBookingRepository.update.mockResolvedValue({
        ...mockBooking,
        status: 'cancelled',
      } as any);
      (prismaService.classSchedule.findMany as jest.Mock).mockResolvedValue([
        { id: 'schedule-1', trainerId: 'trainer-1' },
      ] as any);

      const result = await service.cancel('booking-1', 'admin-user', true);

      expect(result.status).toBe('cancelled');
    });

    it('should throw BadRequestException when booking is already cancelled', async () => {
      classBookingRepository.getById.mockResolvedValue({
        ...mockBooking,
        status: 'cancelled',
      } as any);

      await expect(
        service.cancel('booking-1', 'user-1', false),
      ).rejects.toThrow('This booking is already cancelled');
    });

    it('should throw BadRequestException when trying to cancel attended booking', async () => {
      classBookingRepository.getById.mockResolvedValue({
        ...mockBooking,
        status: 'attended',
      } as any);

      await expect(
        service.cancel('booking-1', 'user-1', false),
      ).rejects.toThrow('Cannot cancel an attended booking');
    });
  });

  describe('findByUserId', () => {
    it('should return bookings for user', async () => {
      classBookingRepository.getByUserId.mockResolvedValue([
        mockBooking as any,
      ]);

      const result = await service.findByUserId('user-1');

      expect(result).toEqual([mockBooking]);
      expect(getBookingsByUserId).toHaveBeenCalledWith('user-1');
    });
  });

  describe('findByClassScheduleId', () => {
    it('should return bookings for schedule', async () => {
      classBookingRepository.getByClassScheduleId.mockResolvedValue([
        mockBooking as any,
      ]);

      const result = await service.findByClassScheduleId('schedule-1');

      expect(result).toEqual([mockBooking]);
      expect(getBookingsByClassScheduleId).toHaveBeenCalledWith(
        'schedule-1',
      );
    });
  });

  describe('update', () => {
    it('should update booking status', async () => {
      classBookingRepository.getById.mockResolvedValue(mockBooking as any);
      classBookingRepository.update.mockResolvedValue({
        ...mockBooking,
        status: 'confirmed',
      } as any);
      (prismaService.classSchedule.findMany as jest.Mock).mockResolvedValue([
        { id: 'schedule-1', trainerId: 'trainer-1' },
      ] as any);

      const result = await service.update('booking-1', { status: 'confirmed' });

      expect(result.status).toBe('confirmed');
      expect(invalidateCacheTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'class-schedule:id:schedule-1',
          'trainer:availability:trainer-1',
        ]),
      );
    });
  });

  describe('remove', () => {
    it('should delete booking', async () => {
      classBookingRepository.getById.mockResolvedValue(mockBooking as any);
      classBookingRepository.delete.mockResolvedValue();
      (prismaService.classSchedule.findMany as jest.Mock).mockResolvedValue([
        { id: 'schedule-1', trainerId: 'trainer-1' },
      ] as any);

      const result = await service.remove('booking-1');

      expect(result).toEqual({
        message: 'Class booking booking-1 deleted successfully',
      });
      expect(deleteBooking).toHaveBeenCalledWith('booking-1');
      expect(invalidateCacheTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'class-schedule:id:schedule-1',
          'trainer:availability:trainer-1',
        ]),
      );
    });
  });
});
