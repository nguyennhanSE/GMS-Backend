import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ExceptionType } from '@prisma/client';
import { ScheduleExceptionEntity } from '../entities/schedule-exception.entity';
import { toScheduleExceptionEntity } from '../mapper/schedule-exception.mapper';

export interface CreateScheduleExceptionData {
  scheduleId: string;
  exceptionDate: Date;
  type: ExceptionType;
  reason?: string;
  newStartTime?: Date;
  newEndTime?: Date;
}

export interface UpdateScheduleExceptionData {
  type?: ExceptionType;
  reason?: string;
  newStartTime?: Date | null;
  newEndTime?: Date | null;
}

@Injectable()
export class ScheduleExceptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new schedule exception
   */
  async create(
    data: CreateScheduleExceptionData,
  ): Promise<ScheduleExceptionEntity> {
    const exceptionDate = this.normalizeDateOnly(data.exceptionDate);
    const exception = await this.prisma.scheduleException.create({
      data: {
        scheduleId: data.scheduleId,
        exceptionDate,
        type: data.type,
        reason: data.reason,
        newStartTime: data.newStartTime,
        newEndTime: data.newEndTime,
      },
    });
    return toScheduleExceptionEntity(exception);
  }

  /**
   * Find exception by ID
   */
  async findById(id: string): Promise<ScheduleExceptionEntity | null> {
    const exception = await this.prisma.scheduleException.findUnique({
      where: { id },
    });
    return exception ? toScheduleExceptionEntity(exception) : null;
  }

  /**
   * Find all exceptions for a schedule
   */
  async findByScheduleId(
    scheduleId: string,
  ): Promise<ScheduleExceptionEntity[]> {
    const exceptions = await this.prisma.scheduleException.findMany({
      where: { scheduleId },
      orderBy: { exceptionDate: 'asc' },
    });
    return exceptions.map(toScheduleExceptionEntity);
  }

  /**
   * Find exception by schedule ID and date
   */
  async findByScheduleIdAndDate(
    scheduleId: string,
    date: Date,
  ): Promise<ScheduleExceptionEntity | null> {
    const normalizedDate = this.normalizeDateOnly(date);
    const exception = await this.prisma.scheduleException.findUnique({
      where: {
        scheduleId_exceptionDate: {
          scheduleId,
          exceptionDate: normalizedDate,
        },
      },
    });
    return exception ? toScheduleExceptionEntity(exception) : null;
  }

  /**
   * Check if a specific date has an exception for a schedule
   */
  async hasException(scheduleId: string, date: Date): Promise<boolean> {
    const exception = await this.findByScheduleIdAndDate(scheduleId, date);
    return exception !== null;
  }

  /**
   * Check if a specific date is cancelled
   */
  async isCancelled(scheduleId: string, date: Date): Promise<boolean> {
    const exception = await this.findByScheduleIdAndDate(scheduleId, date);
    return exception?.type === 'CANCELLED';
  }

  /**
   * Update an exception
   */
  async update(
    id: string,
    data: UpdateScheduleExceptionData,
  ): Promise<ScheduleExceptionEntity> {
    const exception = await this.prisma.scheduleException.update({
      where: { id },
      data: {
        type: data.type,
        reason: data.reason,
        newStartTime: data.newStartTime,
        newEndTime: data.newEndTime,
      },
    });
    return toScheduleExceptionEntity(exception);
  }

  /**
   * Delete an exception
   */
  async delete(id: string): Promise<void> {
    await this.prisma.scheduleException.delete({
      where: { id },
    });
  }

  /**
   * Delete all exceptions for a schedule
   */
  async deleteByScheduleId(scheduleId: string): Promise<void> {
    await this.prisma.scheduleException.deleteMany({
      where: { scheduleId },
    });
  }

  private normalizeDateOnly(date: Date): Date {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }
}
