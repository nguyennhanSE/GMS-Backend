import { Prisma } from '@prisma/client';
import { ClassBookingEntity } from '../entities/class-booking.entity';
import { CreateClassBookingDto } from '../dto/create-class-booking.dto';
import { toUserEntity } from 'src/modules/user/mapper/user.mapper';
import { toClassScheduleEntity } from 'src/modules/class-schedule/mapper/class-schedule.mapper';

type ClassBookingModel = Prisma.ClassBookingGetPayload<Record<string, never>>;
type ClassBookingWithRelations = Prisma.ClassBookingGetPayload<{
  include: {
    user: true;
    classSchedule: {
      include: { gymClass: true; scheduleDays: true };
    };
  };
}>;

/**
 * Maps Prisma ClassBooking model to ClassBookingEntity
 */
export function toClassBookingEntity(
  classBooking: ClassBookingModel,
): ClassBookingEntity {
  return {
    id: classBooking.id,
    userId: classBooking.userId || '',
    classScheduleId: classBooking.classScheduleId || '',
    bookingStartDate: classBooking.bookingStartDate,
    bookingEndDate: classBooking.bookingEndDate,
    status: classBooking.status || '',
    createdAt: classBooking.createdAt,
    updatedAt: null,
  };
}

/**
 * Maps Prisma ClassBooking with relations to ClassBookingEntity
 */
export function toClassBookingEntityWithRelations(
  classBooking: ClassBookingWithRelations,
): ClassBookingEntity {
  return {
    id: classBooking.id,
    userId: classBooking.userId || '',
    classScheduleId: classBooking.classScheduleId || '',
    bookingStartDate: classBooking.bookingStartDate,
    bookingEndDate: classBooking.bookingEndDate,
    status: classBooking.status || '',
    createdAt: classBooking.createdAt,
    updatedAt: null,
    user: classBooking.user ? toUserEntity(classBooking.user) : null,
    classSchedule: classBooking.classSchedule
      ? toClassScheduleEntity(classBooking.classSchedule)
      : null,
  };
}

/**
 * Maps CreateClassBookingDto to Prisma ClassBooking create input
 */
export function toPrismaClassBookingCreateInput(
  dto: CreateClassBookingDto,
): Prisma.ClassBookingCreateInput {
  return {
    bookingStartDate: dto.bookingStartDate || new Date(),
    bookingEndDate: dto.bookingEndDate || new Date(),
    status: dto.status || 'pending',
    user: {
      connect: { id: dto.userId },
    },
    classSchedule: {
      connect: { id: dto.classScheduleId },
    },
  };
}

/**
 * Maps ClassBookingEntity to response DTO
 * Now includes gymClass info from the schedule
 */
export function toResponse(entity: ClassBookingEntity) {
  const schedule = entity.classSchedule;
  const gymClass = schedule?.gymClass;

  return {
    id: entity.id,
    userId: entity.userId,
    classScheduleId: entity.classScheduleId,
    bookingStartDate: entity.bookingStartDate,
    bookingEndDate: entity.bookingEndDate,
    status: entity.status,
    createdAt: entity.createdAt,
    user: entity.user
      ? {
          id: entity.user.id,
          firstName: entity.user.firstName,
          lastName: entity.user.lastName,
          email: entity.user.email,
        }
      : null,
    classSchedule: schedule
      ? {
          id: schedule.id,
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          location: schedule.location,
          capacity: schedule.capacity,
          trainerId: schedule.trainerId,
          // Class info from gymClass relation
          className: gymClass?.className ?? null,
          description: gymClass?.description ?? null,
          category: gymClass?.category ?? null,
          difficultyLevel: gymClass?.difficultyLevel ?? null,
        }
      : null,
  };
}
