import { Test, TestingModule } from '@nestjs/testing';
import { ClassScheduleService } from './class-schedule.service';
import { ClassScheduleRepository } from './repositories/class-schedule.repository';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DayOfWeekDto } from './dto/create-class-schedule.dto';
import { TrainerService } from '../trainer/trainer.service';
import { AppCacheService } from '../../libs/cache/cache.service';

describe('ClassScheduleService', () => {
  let service: ClassScheduleService;
  let repository: jest.Mocked<ClassScheduleRepository>;
  let trainerService: jest.Mocked<Pick<TrainerService, 'isWithinWorkingHours'>>;
  let appCacheService: {
    remember: jest.Mock;
    invalidateTags: jest.Mock;
  };
  let checkScheduleConflict: jest.Mock;
  let createSchedule: jest.Mock;
  let deleteSchedule: jest.Mock;
  let getConflictingSchedules: jest.Mock;
  let getSchedulesByDayOfWeek: jest.Mock;
  let getSchedulesByTrainerId: jest.Mock;
  let rememberCache: jest.Mock;
  let invalidateCacheTags: jest.Mock;
  let isWithinWorkingHours: jest.Mock;

  // Mock schedule with new schema structure (supports multi-day via scheduleDays)
  const mockSchedule = {
    id: 'schedule-1',
    classId: 'class-1',
    trainerId: 'trainer-1',
    dayOfWeek: DayOfWeekDto.MON, // Legacy field
    scheduleDays: [
      { id: 'sd-1', scheduleId: 'schedule-1', dayOfWeek: DayOfWeekDto.MON },
    ], // New multi-day support
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
      description: 'Relaxing yoga class',
      difficultyLevel: 'Beginner',
      category: 'Yoga',
      isActive: true,
    },
  };

  // Updated to use daysOfWeek array for multi-day support
  const mockCreateDto = {
    classId: 'class-1',
    trainerId: 'trainer-1',
    daysOfWeek: [DayOfWeekDto.MON], // Use new daysOfWeek array
    startTime: new Date('2030-01-01T09:00:00Z'),
    endTime: new Date('2030-01-01T10:00:00Z'),
    location: 'Studio A',
    capacity: 20,
  };

  beforeEach(async () => {
    checkScheduleConflict = jest.fn();
    createSchedule = jest.fn();
    deleteSchedule = jest.fn();
    getConflictingSchedules = jest.fn();
    getSchedulesByDayOfWeek = jest.fn();
    getSchedulesByTrainerId = jest.fn();
    rememberCache = jest.fn((_key, loader) => loader());
    invalidateCacheTags = jest.fn();
    isWithinWorkingHours = jest
      .fn()
      .mockResolvedValue({ withinHours: true });

    const mockRepository = {
      getById: jest.fn(),
      create: createSchedule,
      update: jest.fn(),
      delete: deleteSchedule,
      getPaginate: jest.fn(),
      getByDayOfWeek: getSchedulesByDayOfWeek,
      getByTrainerId: getSchedulesByTrainerId,
      checkScheduleConflict: checkScheduleConflict,
      getConflictingSchedules: getConflictingSchedules,
    };

    trainerService = {
      isWithinWorkingHours: isWithinWorkingHours,
    };

    appCacheService = {
      remember: rememberCache,
      invalidateTags: invalidateCacheTags,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassScheduleService,
        { provide: ClassScheduleRepository, useValue: mockRepository },
        { provide: TrainerService, useValue: trainerService },
        { provide: AppCacheService, useValue: appCacheService },
      ],
    }).compile();

    service = module.get<ClassScheduleService>(ClassScheduleService);
    repository = module.get(ClassScheduleRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // =====================================================
  // PHASE 1: SCHEDULE VALIDATION (CONFLICT DETECTION)
  // =====================================================

  describe('create - Conflict Detection', () => {
    it('should create schedule when no conflict exists', async () => {
      // Arrange
      repository.checkScheduleConflict.mockResolvedValue(false);
      repository.create.mockResolvedValue(mockSchedule as any);

      // Act
      const result = await service.create(mockCreateDto);

      // Assert
      expect(checkScheduleConflict).toHaveBeenCalledWith(
        'trainer-1',
        'MON',
        mockCreateDto.startTime,
        mockCreateDto.endTime,
      );
      expect(isWithinWorkingHours).toHaveBeenCalledWith(
        'trainer-1',
        DayOfWeekDto.MON,
        mockCreateDto.startTime,
        mockCreateDto.endTime,
      );
      expect(createSchedule).toHaveBeenCalledWith(mockCreateDto);
      expect(result).toEqual(mockSchedule);
      expect(invalidateCacheTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'class-schedule:list',
          'class-schedule:detail',
          'class-schedule:id:schedule-1',
          'class-schedule:day',
          'class-schedule:trainer',
          'class-schedule:trainer:trainer-1',
          'trainer:availability:trainer-1',
        ]),
      );
    });

    it('should throw BadRequestException when trainer has conflicting schedule', async () => {
      // Arrange
      const conflictingSchedule = {
        ...mockSchedule,
        id: 'schedule-2',
        gymClass: { ...mockSchedule.gymClass, className: 'HIIT Training' },
      };

      repository.checkScheduleConflict.mockResolvedValue(true);
      repository.getConflictingSchedules.mockResolvedValue([
        conflictingSchedule as any,
      ]);

      // Act & Assert
      await expect(service.create(mockCreateDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(mockCreateDto)).rejects.toThrow(
        /Trainer already has a class scheduled at this time on MON/,
      );
    });

    it('should include conflicting schedule details in error message', async () => {
      // Arrange
      const conflictingSchedule = {
        ...mockSchedule,
        id: 'schedule-2',
        startTime: new Date('2030-01-01T08:30:00Z'),
        endTime: new Date('2030-01-01T09:30:00Z'),
        gymClass: { className: 'HIIT Training' },
      };

      repository.checkScheduleConflict.mockResolvedValue(true);
      repository.getConflictingSchedules.mockResolvedValue([
        conflictingSchedule as any,
      ]);

      // Act & Assert
      try {
        await service.create(mockCreateDto);
        fail('Expected BadRequestException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain(
          'HIIT Training',
        );
        expect((error as BadRequestException).message).toContain('08:30');
        expect((error as BadRequestException).message).toContain('09:30');
      }
    });

    it('should detect conflict for different day of week correctly', async () => {
      // Arrange
      const tuesdayDto = { ...mockCreateDto, daysOfWeek: [DayOfWeekDto.TUE] };
      repository.checkScheduleConflict.mockResolvedValue(false);
      repository.create.mockResolvedValue({
        ...mockSchedule,
        dayOfWeek: DayOfWeekDto.TUE,
        scheduleDays: [
          { id: 'sd-2', scheduleId: 'schedule-1', dayOfWeek: DayOfWeekDto.TUE },
        ],
      } as any);

      // Act
      await service.create(tuesdayDto);

      // Assert
      expect(checkScheduleConflict).toHaveBeenCalledWith(
        'trainer-1',
        'TUE',
        mockCreateDto.startTime,
        mockCreateDto.endTime,
      );
    });
  });

  describe('update - Conflict Detection', () => {
    it('should update schedule without conflict check when scheduling fields unchanged', async () => {
      // Arrange
      repository.getById.mockResolvedValue(mockSchedule as any);
      repository.update.mockResolvedValue({
        ...mockSchedule,
        location: 'Studio B',
      } as any);

      // Act
      const result = await service.update('schedule-1', {
        location: 'Studio B',
      });

      // Assert
      expect(checkScheduleConflict).not.toHaveBeenCalled();
      expect(result.location).toBe('Studio B');
    });

    it('should check for conflicts when updating startTime', async () => {
      // Arrange
      const newStartTime = new Date('2030-01-01T08:00:00Z');
      repository.getById.mockResolvedValue(mockSchedule as any);
      repository.checkScheduleConflict.mockResolvedValue(false);
      repository.update.mockResolvedValue({
        ...mockSchedule,
        startTime: newStartTime,
      } as any);

      // Act
      await service.update('schedule-1', { startTime: newStartTime });

      // Assert
      expect(checkScheduleConflict).toHaveBeenCalledWith(
        'trainer-1',
        'MON',
        newStartTime,
        mockSchedule.endTime,
        'schedule-1', // Exclude current schedule
      );
    });

    it('should check for conflicts when updating endTime', async () => {
      // Arrange
      const newEndTime = new Date('2030-01-01T11:00:00Z');
      repository.getById.mockResolvedValue(mockSchedule as any);
      repository.checkScheduleConflict.mockResolvedValue(false);
      repository.update.mockResolvedValue({
        ...mockSchedule,
        endTime: newEndTime,
      } as any);

      // Act
      await service.update('schedule-1', { endTime: newEndTime });

      // Assert
      expect(checkScheduleConflict).toHaveBeenCalledWith(
        'trainer-1',
        'MON',
        mockSchedule.startTime,
        newEndTime,
        'schedule-1',
      );
    });

    it('should check for conflicts when updating dayOfWeek', async () => {
      // Arrange
      repository.getById.mockResolvedValue(mockSchedule as any);
      repository.checkScheduleConflict.mockResolvedValue(false);
      repository.update.mockResolvedValue({
        ...mockSchedule,
        dayOfWeek: DayOfWeekDto.TUE,
      } as any);

      // Act
      await service.update('schedule-1', { dayOfWeek: DayOfWeekDto.TUE });

      // Assert
      expect(checkScheduleConflict).toHaveBeenCalledWith(
        'trainer-1',
        'TUE',
        mockSchedule.startTime,
        mockSchedule.endTime,
        'schedule-1',
      );
    });

    it('should check for conflicts when updating trainerId', async () => {
      // Arrange
      repository.getById.mockResolvedValue(mockSchedule as any);
      repository.checkScheduleConflict.mockResolvedValue(false);
      repository.update.mockResolvedValue({
        ...mockSchedule,
        trainerId: 'trainer-2',
      } as any);

      // Act
      await service.update('schedule-1', { trainerId: 'trainer-2' });

      // Assert
      expect(checkScheduleConflict).toHaveBeenCalledWith(
        'trainer-2',
        'MON',
        mockSchedule.startTime,
        mockSchedule.endTime,
        'schedule-1',
      );
      expect(invalidateCacheTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'class-schedule:id:schedule-1',
          'class-schedule:trainer:trainer-1',
          'class-schedule:trainer:trainer-2',
          'trainer:availability:trainer-1',
          'trainer:availability:trainer-2',
        ]),
      );
    });

    it('should throw BadRequestException when update causes conflict', async () => {
      // Arrange
      const conflictingSchedule = {
        ...mockSchedule,
        id: 'schedule-2',
        trainerId: 'trainer-2',
        gymClass: { className: 'Pilates' },
      };

      repository.getById.mockResolvedValue(mockSchedule as any);
      repository.checkScheduleConflict.mockResolvedValue(true);
      repository.getConflictingSchedules.mockResolvedValue([
        conflictingSchedule as any,
      ]);

      // Act & Assert
      await expect(
        service.update('schedule-1', { trainerId: 'trainer-2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when schedule does not exist', async () => {
      // Arrange
      repository.getById.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.update('non-existent', { location: 'Studio B' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkConflict', () => {
    it('should return hasConflict: false when no conflicts exist', async () => {
      // Arrange
      repository.getConflictingSchedules.mockResolvedValue([]);

      // Act
      const result = await service.checkConflict(
        'trainer-1',
        'MON',
        new Date('2030-01-01T09:00:00Z'),
        new Date('2030-01-01T10:00:00Z'),
      );

      // Assert
      expect(result.hasConflict).toBe(false);
      expect(result.conflictingSchedules).toHaveLength(0);
    });

    it('should return hasConflict: true with conflicting schedules', async () => {
      // Arrange
      repository.getConflictingSchedules.mockResolvedValue([
        mockSchedule as any,
      ]);

      // Act
      const result = await service.checkConflict(
        'trainer-1',
        'MON',
        new Date('2030-01-01T09:30:00Z'),
        new Date('2030-01-01T10:30:00Z'),
      );

      // Assert
      expect(result.hasConflict).toBe(true);
      expect(result.conflictingSchedules).toHaveLength(1);
      expect(result.conflictingSchedules[0].id).toBe('schedule-1');
    });

    it('should pass excludeScheduleId for update scenarios', async () => {
      // Arrange
      repository.getConflictingSchedules.mockResolvedValue([]);

      // Act
      await service.checkConflict(
        'trainer-1',
        'MON',
        new Date('2030-01-01T09:00:00Z'),
        new Date('2030-01-01T10:00:00Z'),
        'schedule-to-exclude',
      );

      // Assert
      expect(getConflictingSchedules).toHaveBeenCalledWith(
        'trainer-1',
        'MON',
        expect.any(Date),
        expect.any(Date),
        'schedule-to-exclude',
      );
    });
  });

  describe('findOne', () => {
    it('should return schedule when found', async () => {
      // Arrange
      repository.getById.mockResolvedValue(mockSchedule as any);

      // Act
      const result = await service.findOne('schedule-1');

      // Assert
      expect(result).toEqual(mockSchedule);
      expect(rememberCache).toHaveBeenCalledWith(
        'gms:class-schedule:detail:schedule-1',
        expect.any(Function),
        expect.objectContaining({
          ttlSeconds: 300,
          tags: ['class-schedule:detail', 'class-schedule:id:schedule-1'],
        }),
      );
    });

    it('should throw NotFoundException when schedule not found', async () => {
      // Arrange
      repository.getById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should delete schedule when exists', async () => {
      // Arrange
      repository.getById.mockResolvedValue(mockSchedule as any);
      repository.delete.mockResolvedValue();

      // Act
      const result = await service.remove('schedule-1');

      // Assert
      expect(result.message).toContain('deleted successfully');
      expect(deleteSchedule).toHaveBeenCalledWith('schedule-1');
      expect(invalidateCacheTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'class-schedule:id:schedule-1',
          'class-schedule:trainer:trainer-1',
          'trainer:availability:trainer-1',
        ]),
      );
    });
  });

  describe('findByDayOfWeek', () => {
    it('should return schedules for given day', async () => {
      // Arrange
      repository.getByDayOfWeek.mockResolvedValue([mockSchedule as any]);

      // Act
      const result = await service.findByDayOfWeek('MON');

      // Assert
      expect(result).toEqual([mockSchedule]);
      expect(getSchedulesByDayOfWeek).toHaveBeenCalledWith('MON');
      expect(rememberCache).toHaveBeenCalledWith(
        'gms:class-schedule:day:MON',
        expect.any(Function),
        expect.objectContaining({
          ttlSeconds: 300,
          tags: ['class-schedule:day'],
        }),
      );
    });
  });

  describe('findByTrainerId', () => {
    it('should return schedules for given trainer', async () => {
      // Arrange
      repository.getByTrainerId.mockResolvedValue([mockSchedule as any]);

      // Act
      const result = await service.findByTrainerId('trainer-1');

      // Assert
      expect(result).toEqual([mockSchedule]);
      expect(getSchedulesByTrainerId).toHaveBeenCalledWith('trainer-1');
      expect(rememberCache).toHaveBeenCalledWith(
        'gms:class-schedule:trainer:trainer-1',
        expect.any(Function),
        expect.objectContaining({
          ttlSeconds: 300,
          tags: ['class-schedule:trainer', 'class-schedule:trainer:trainer-1'],
        }),
      );
    });
  });
});
