import {
  ClassSchedule as PrismaClassSchedule,
  GymClass,
  Prisma,
  ScheduleDay,
  ScheduleException,
} from '@prisma/client';
import {
  ClassScheduleOccurrenceEntity,
  ClassScheduleEntity,
  DayOfWeek,
  ScheduleDayEntity,
} from '../entities/class-schedule.entity';
import { GymClassEntity, DifficultyLevel } from '../entities/gym-class.entity';
import { toClassBookingEntity } from 'src/modules/class-booking/mapper/class-booking.mapper';
import { toScheduleExceptionResponse } from './schedule-exception.mapper';

type ClassScheduleModel = PrismaClassSchedule & {
  gymClass?: GymClass | null;
  scheduleDays?: ScheduleDay[];
  scheduleExceptions?: ScheduleException[];
};
type ClassScheduleWithRelations = Prisma.ClassScheduleGetPayload<{
  include: {
    classBookings: true;
    trainer: true;
    gymClass: true;
    scheduleDays: true;
  };
}>;

/**
 * Maps Prisma GymClass model to GymClassEntity
 */
export function toGymClassEntity(gymClass: any): GymClassEntity {
  return {
    id: gymClass.id,
    className: gymClass.className,
    description: gymClass.description,
    difficultyLevel: gymClass.difficultyLevel as DifficultyLevel,
    category: gymClass.category,
    isActive: gymClass.isActive,
    createdAt: gymClass.createdAt,
    updatedAt: gymClass.updatedAt,
  };
}

/**
 * Maps Prisma ScheduleDay to ScheduleDayEntity
 */
export function toScheduleDayEntity(scheduleDay: any): ScheduleDayEntity {
  return {
    id: scheduleDay.id,
    scheduleId: scheduleDay.scheduleId,
    dayOfWeek: scheduleDay.dayOfWeek as DayOfWeek,
    createdAt: scheduleDay.createdAt,
  };
}

function formatDateOnly(date: Date): string {
  return date.toISOString().split('T')[0];
}

function toOccurrenceResponse(occurrence: ClassScheduleOccurrenceEntity) {
  return {
    date: formatDateOnly(occurrence.date),
    status: occurrence.status,
    effectiveStartTime: occurrence.effectiveStartTime,
    effectiveEndTime: occurrence.effectiveEndTime,
    isBookable: occurrence.isBookable,
    currentBookings: occurrence.currentBookings,
    remainingSlots: occurrence.remainingSlots,
    exception: occurrence.exception
      ? toScheduleExceptionResponse(occurrence.exception)
      : null,
  };
}

/**
 * Maps Prisma ClassSchedule model to ClassScheduleEntity
 * Now includes gymClass and scheduleDays relations
 */
export function toClassScheduleEntity(
  classSchedule: ClassScheduleModel,
): ClassScheduleEntity {
  return {
    id: classSchedule.id,
    classId: classSchedule.classId,
    trainerId: classSchedule.trainerId,
    dayOfWeek: classSchedule.dayOfWeek as DayOfWeek | null,
    startTime: classSchedule.startTime,
    endTime: classSchedule.endTime,
    validFrom: classSchedule.validFrom,
    validUntil: classSchedule.validUntil,
    location: classSchedule.location,
    capacity: classSchedule.capacity,
    isActive: classSchedule.isActive,
    createdAt: classSchedule.createdAt,
    updatedAt: classSchedule.updatedAt,
    gymClass: classSchedule.gymClass
      ? toGymClassEntity(classSchedule.gymClass)
      : null,
    scheduleDays: classSchedule.scheduleDays?.map(toScheduleDayEntity) ?? [],
  };
}

/**
 * Maps ClassScheduleEntity to response DTO
 * Flattens gymClass info into the response
 * Now includes daysOfWeek array for multi-day schedules
 */
export function toResponse(entity: ClassScheduleEntity) {
  // Get all days from scheduleDays or fallback to legacy dayOfWeek
  const daysOfWeek =
    entity.scheduleDays && entity.scheduleDays.length > 0
      ? entity.scheduleDays.map((sd) => sd.dayOfWeek)
      : entity.dayOfWeek
        ? [entity.dayOfWeek]
        : [];

  const currentBookings = entity.occurrence?.currentBookings ?? entity.bookingsCount ?? 0;
  const remainingSlots =
    entity.occurrence?.remainingSlots ??
    Math.max(0, entity.capacity - (entity.bookingsCount ?? 0));

  return {
    id: entity.id,
    // Class info from gymClass
    className: entity.gymClass?.className,
    description: entity.gymClass?.description,
    category: entity.gymClass?.category,
    difficultyLevel: entity.gymClass?.difficultyLevel,
    // Schedule info - support both legacy single day and new multi-day
    dayOfWeek: entity.dayOfWeek, // Legacy field
    daysOfWeek, // New multi-day field
    startTime: entity.startTime,
    endTime: entity.endTime,
    validFrom: entity.validFrom,
    validUntil: entity.validUntil,
    location: entity.location,
    capacity: entity.capacity,
    // Availability info (per-date, only present when date context is provided)
    currentBookings,
    remainingSlots,
    isActive: entity.isActive,
    trainerId: entity.trainerId,
    trainer: entity.trainer,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    ...(entity.occurrence
      ? {
          occurrence: toOccurrenceResponse(entity.occurrence),
        }
      : {}),
  };
}

export function toClassScheduleWithRelations(
  classSchedule: ClassScheduleWithRelations,
): ClassScheduleEntity {
  return {
    id: classSchedule.id,
    classId: classSchedule.classId,
    trainerId: classSchedule.trainerId,
    dayOfWeek: classSchedule.dayOfWeek as DayOfWeek | null,
    startTime: classSchedule.startTime,
    endTime: classSchedule.endTime,
    validFrom: classSchedule.validFrom,
    validUntil: classSchedule.validUntil,
    location: classSchedule.location,
    capacity: classSchedule.capacity,
    isActive: classSchedule.isActive,
    createdAt: classSchedule.createdAt,
    updatedAt: classSchedule.updatedAt,
    gymClass: classSchedule.gymClass
      ? toGymClassEntity(classSchedule.gymClass)
      : null,
    scheduleDays: classSchedule.scheduleDays?.map(toScheduleDayEntity) ?? [],
    classBookings: classSchedule.classBookings.map((x) =>
      toClassBookingEntity(x),
    ),
    trainer: classSchedule.trainer
      ? {
          id: classSchedule.trainer.id,
          firstName: classSchedule.trainer.firstName,
          lastName: classSchedule.trainer.lastName,
          email: classSchedule.trainer.email,
        }
      : null,
  };
}
