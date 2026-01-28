import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ExceptionType } from '@prisma/client';
import { ScheduleExceptionRepository } from './repositories/schedule-exception.repository';
import { ClassScheduleRepository } from './repositories/class-schedule.repository';
import { ScheduleExceptionEntity } from './entities/schedule-exception.entity';
import {
  CreateScheduleExceptionDto,
  UpdateScheduleExceptionDto,
  ExceptionTypeDto,
} from './dto/schedule-exception.dto';

@Injectable()
export class ScheduleExceptionService {
  constructor(
    private readonly exceptionRepository: ScheduleExceptionRepository,
    private readonly scheduleRepository: ClassScheduleRepository,
  ) {}

  /**
   * Create a new schedule exception
   */
  async create(
    scheduleId: string,
    dto: CreateScheduleExceptionDto,
  ): Promise<ScheduleExceptionEntity> {
    // Verify schedule exists
    const schedule = await this.scheduleRepository.getById(scheduleId);
    if (!schedule) {
      throw new NotFoundException(`Schedule with ID ${scheduleId} not found`);
    }

    // Parse exception date
    const exceptionDate = new Date(dto.exceptionDate);

    // Check if exception already exists for this date
    const existing = await this.exceptionRepository.findByScheduleIdAndDate(
      scheduleId,
      exceptionDate,
    );
    if (existing) {
      throw new ConflictException(
        `An exception already exists for ${dto.exceptionDate} on this schedule`,
      );
    }

    // Validate RESCHEDULED type requires new times
    if (dto.type === ExceptionTypeDto.RESCHEDULED) {
      if (!dto.newStartTime || !dto.newEndTime) {
        throw new BadRequestException(
          'RESCHEDULED exceptions require newStartTime and newEndTime',
        );
      }
    }

    // Parse times if provided
    let newStartTime: Date | undefined;
    let newEndTime: Date | undefined;

    if (dto.newStartTime) {
      newStartTime = this.parseTimeString(dto.newStartTime);
    }
    if (dto.newEndTime) {
      newEndTime = this.parseTimeString(dto.newEndTime);
    }

    return this.exceptionRepository.create({
      scheduleId,
      exceptionDate,
      type: dto.type as ExceptionType,
      reason: dto.reason,
      newStartTime,
      newEndTime,
    });
  }

  /**
   * Get all exceptions for a schedule
   */
  async findByScheduleId(
    scheduleId: string,
  ): Promise<ScheduleExceptionEntity[]> {
    // Verify schedule exists
    const schedule = await this.scheduleRepository.getById(scheduleId);
    if (!schedule) {
      throw new NotFoundException(`Schedule with ID ${scheduleId} not found`);
    }

    return this.exceptionRepository.findByScheduleId(scheduleId);
  }

  /**
   * Get a single exception by ID
   */
  async findById(id: string): Promise<ScheduleExceptionEntity> {
    const exception = await this.exceptionRepository.findById(id);
    if (!exception) {
      throw new NotFoundException(`Exception with ID ${id} not found`);
    }
    return exception;
  }

  /**
   * Update an exception
   */
  async update(
    id: string,
    dto: UpdateScheduleExceptionDto,
  ): Promise<ScheduleExceptionEntity> {
    // Verify exception exists
    const existing = await this.findById(id);

    // Validate RESCHEDULED type requires new times
    const newType = dto.type ?? existing.type;
    if (newType === 'RESCHEDULED') {
      const hasNewStartTime =
        dto.newStartTime !== undefined || existing.newStartTime !== null;
      const hasNewEndTime =
        dto.newEndTime !== undefined || existing.newEndTime !== null;

      if (!hasNewStartTime || !hasNewEndTime) {
        throw new BadRequestException(
          'RESCHEDULED exceptions require newStartTime and newEndTime',
        );
      }
    }

    // Parse times if provided
    let newStartTime: Date | null | undefined;
    let newEndTime: Date | null | undefined;

    if (dto.newStartTime !== undefined) {
      newStartTime = dto.newStartTime
        ? this.parseTimeString(dto.newStartTime)
        : null;
    }
    if (dto.newEndTime !== undefined) {
      newEndTime = dto.newEndTime ? this.parseTimeString(dto.newEndTime) : null;
    }

    return this.exceptionRepository.update(id, {
      type: dto.type as ExceptionType | undefined,
      reason: dto.reason,
      newStartTime,
      newEndTime,
    });
  }

  /**
   * Delete an exception
   */
  async remove(id: string): Promise<{ message: string }> {
    // Verify exception exists
    await this.findById(id);

    await this.exceptionRepository.delete(id);
    return { message: `Exception ${id} deleted successfully` };
  }

  /**
   * Check if a schedule is cancelled on a specific date
   */
  async isClassCancelledOnDate(
    scheduleId: string,
    date: Date,
  ): Promise<boolean> {
    return this.exceptionRepository.isCancelled(scheduleId, date);
  }

  /**
   * Get exception for a specific date (if exists)
   */
  async getExceptionForDate(
    scheduleId: string,
    date: Date,
  ): Promise<ScheduleExceptionEntity | null> {
    return this.exceptionRepository.findByScheduleIdAndDate(scheduleId, date);
  }

  /**
   * Parse time string (HH:mm or HH:mm:ss) to Date object
   */
  private parseTimeString(timeStr: string): Date {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parts[2] ? parseInt(parts[2], 10) : 0;

    // Create a date with just the time component (1970-01-01)
    const date = new Date(1970, 0, 1, hours, minutes, seconds);
    return date;
  }
}
