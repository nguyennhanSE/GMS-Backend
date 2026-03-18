import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ClassScheduleEntity } from './entities/class-schedule.entity';
import { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';
import {
  ClassScheduleRepository,
  ClassScheduleFilterDto,
} from './repositories/class-schedule.repository';
import {
  IPaginate,
  PaginateOptions,
} from '../../libs/models/paginate/pagimate.model';
import { DayOfWeek } from '@prisma/client';
import { TrainerService } from '../trainer/trainer.service';

@Injectable()
export class ClassScheduleService {
  constructor(
    private readonly classScheduleRepository: ClassScheduleRepository,
    private readonly trainerService: TrainerService,
  ) {}

  /**
   * Create a new class schedule with conflict detection
   * Prevents trainers from having overlapping schedules
   */
  async create(
    createClassScheduleDto: CreateClassScheduleDto,
  ): Promise<ClassScheduleEntity> {
    // Get day of week from daysOfWeek array (new multi-day format) or fallback to dayOfWeek (legacy)
    const dayOfWeek = (createClassScheduleDto.daysOfWeek?.[0] ??
      createClassScheduleDto.dayOfWeek) as DayOfWeek;

    // Layer 1: Check if trainer is within working hours
    const workingHoursCheck = await this.trainerService.isWithinWorkingHours(
      createClassScheduleDto.trainerId,
      dayOfWeek,
      createClassScheduleDto.startTime,
      createClassScheduleDto.endTime,
    );

    if (!workingHoursCheck.withinHours) {
      throw new BadRequestException(
        `Cannot create schedule: ${workingHoursCheck.reason}`,
      );
    }

    // Layer 2: Check for trainer schedule conflicts
    const hasConflict =
      await this.classScheduleRepository.checkScheduleConflict(
        createClassScheduleDto.trainerId,
        dayOfWeek,
        createClassScheduleDto.startTime,
        createClassScheduleDto.endTime,
      );

    if (hasConflict) {
      const conflictingSchedules =
        await this.classScheduleRepository.getConflictingSchedules(
          createClassScheduleDto.trainerId,
          dayOfWeek,
          createClassScheduleDto.startTime,
          createClassScheduleDto.endTime,
        );

      const conflictInfo = conflictingSchedules
        .map(
          (s) =>
            `"${s.gymClass?.className}" (${s.startTime?.toISOString().slice(11, 16)}-${s.endTime?.toISOString().slice(11, 16)})`,
        )
        .join(', ');

      throw new BadRequestException(
        `Trainer already has a class scheduled at this time on ${dayOfWeek}. ` +
          `Conflicting schedule(s): ${conflictInfo}`,
      );
    }

    return this.classScheduleRepository.create(createClassScheduleDto);
  }

  /**
   * Get paginated class schedules with optional per-date availability
   */
  async findAll(
    paginateRequest: PaginateOptions,
    filter: ClassScheduleFilterDto,
    options: { counted?: boolean },
    targetDate?: Date,
  ): Promise<IPaginate<ClassScheduleEntity>> {
    return this.classScheduleRepository.getPaginate(
      filter,
      {
        ...paginateRequest,
        counted: options.counted,
      },
      targetDate,
    );
  }

  /**
   * Find one class schedule by id with optional per-date availability
   */
  async findOne(id: string, targetDate?: Date): Promise<ClassScheduleEntity> {
    const classSchedule = await this.classScheduleRepository.getById(
      id,
      targetDate,
    );
    if (!classSchedule) {
      throw new NotFoundException(`Class schedule with id ${id} not found`);
    }
    return classSchedule;
  }

  /**
   * Update class schedule with conflict detection
   * Prevents trainers from having overlapping schedules
   */
  async update(
    id: string,
    updateClassScheduleDto: UpdateClassScheduleDto,
  ): Promise<ClassScheduleEntity> {
    // Check if class schedule exists
    const existing = await this.findOne(id);

    // If updating time or day, check for conflicts
    const trainerId = updateClassScheduleDto.trainerId ?? existing.trainerId;
    const dayOfWeek = updateClassScheduleDto.dayOfWeek ?? existing.dayOfWeek;
    const startTime = updateClassScheduleDto.startTime ?? existing.startTime;
    const endTime = updateClassScheduleDto.endTime ?? existing.endTime;

    // Only check conflicts if any scheduling field is being updated
    if (
      updateClassScheduleDto.trainerId !== undefined ||
      updateClassScheduleDto.dayOfWeek !== undefined ||
      updateClassScheduleDto.startTime !== undefined ||
      updateClassScheduleDto.endTime !== undefined
    ) {
      // Layer 1: Check if trainer is within working hours
      const workingHoursCheck = await this.trainerService.isWithinWorkingHours(
        trainerId,
        dayOfWeek as DayOfWeek,
        startTime instanceof Date ? startTime : new Date(startTime),
        endTime instanceof Date ? endTime : new Date(endTime),
      );

      if (!workingHoursCheck.withinHours) {
        throw new BadRequestException(
          `Cannot update schedule: ${workingHoursCheck.reason}`,
        );
      }

      // Layer 2: Check for trainer schedule conflicts
      const hasConflict =
        await this.classScheduleRepository.checkScheduleConflict(
          trainerId,
          dayOfWeek as DayOfWeek,
          startTime,
          endTime,
          id, // Exclude current schedule
        );

      if (hasConflict) {
        const conflictingSchedules =
          await this.classScheduleRepository.getConflictingSchedules(
            trainerId,
            dayOfWeek as DayOfWeek,
            startTime,
            endTime,
            id,
          );

        const conflictInfo = conflictingSchedules
          .map(
            (s) =>
              `"${s.gymClass?.className}" (${s.startTime?.toISOString().slice(11, 16)}-${s.endTime?.toISOString().slice(11, 16)})`,
          )
          .join(', ');

        throw new BadRequestException(
          `Trainer already has a class scheduled at this time on ${dayOfWeek}. ` +
            `Conflicting schedule(s): ${conflictInfo}`,
        );
      }
    }

    return this.classScheduleRepository.update(id, updateClassScheduleDto);
  }

  /**
   * Remove class schedule
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if class schedule exists
    await this.findOne(id);

    // Delete class schedule
    await this.classScheduleRepository.delete(id);

    return { message: `Class schedule ${id} deleted successfully` };
  }

  /**
   * Get schedules by day of week (for weekly schedule views)
   */
  async findByDayOfWeek(dayOfWeek: DayOfWeek): Promise<ClassScheduleEntity[]> {
    return this.classScheduleRepository.getByDayOfWeek(dayOfWeek);
  }

  /**
   * Get schedules by trainer (for trainer dashboards)
   */
  async findByTrainerId(trainerId: string): Promise<ClassScheduleEntity[]> {
    return this.classScheduleRepository.getByTrainerId(trainerId);
  }

  /**
   * Check if proposed schedule conflicts with existing schedules
   * Useful for frontend validation before submitting
   */
  async checkConflict(
    trainerId: string,
    dayOfWeek: DayOfWeek,
    startTime: Date,
    endTime: Date,
    excludeScheduleId?: string,
  ): Promise<{
    hasConflict: boolean;
    conflictingSchedules: ClassScheduleEntity[];
  }> {
    const conflictingSchedules =
      await this.classScheduleRepository.getConflictingSchedules(
        trainerId,
        dayOfWeek,
        startTime,
        endTime,
        excludeScheduleId,
      );

    return {
      hasConflict: conflictingSchedules.length > 0,
      conflictingSchedules,
    };
  }
}
