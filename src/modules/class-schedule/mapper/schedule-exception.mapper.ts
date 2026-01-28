import { ScheduleException } from '@prisma/client';
import { ScheduleExceptionEntity } from '../entities/schedule-exception.entity';
import {
  ScheduleExceptionResponseDto,
  ExceptionTypeDto,
} from '../dto/schedule-exception.dto';

/**
 * Map Prisma ScheduleException model to entity
 */
export function toScheduleExceptionEntity(
  model: ScheduleException,
): ScheduleExceptionEntity {
  return {
    id: model.id,
    scheduleId: model.scheduleId,
    exceptionDate: model.exceptionDate,
    type: model.type,
    reason: model.reason,
    newStartTime: model.newStartTime,
    newEndTime: model.newEndTime,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

/**
 * Map entity to response DTO
 */
export function toScheduleExceptionResponse(
  entity: ScheduleExceptionEntity,
): ScheduleExceptionResponseDto {
  return {
    id: entity.id,
    scheduleId: entity.scheduleId,
    exceptionDate: entity.exceptionDate,
    type: entity.type as ExceptionTypeDto,
    reason: entity.reason,
    newStartTime: entity.newStartTime,
    newEndTime: entity.newEndTime,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
