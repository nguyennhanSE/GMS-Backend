import { Prisma } from '@prisma/client';
import { ClassScheduleEntity } from '../entities/class-schedule.entity';
import { CreateClassScheduleDto } from '../dto/create-class-schedule.dto';
import { toClassBookingEntity } from 'src/modules/class-booking/mapper/class-booking.mapper';

type ClassScheduleModel = Prisma.ClassScheduleGetPayload<Record<string, never>>;
type ClassScheduleWithRelations = Prisma.ClassScheduleGetPayload<{
  include: {
    classBookings: true;
    trainer: true;
  };
}>;

/**
 * Maps Prisma ClassSchedule model to ClassScheduleEntity
 */
export function toClassScheduleEntity(classSchedule: ClassScheduleModel): ClassScheduleEntity {
  return {
    id: classSchedule.id,
    name: classSchedule.name,
    description: classSchedule.description || '',
    createdAt: classSchedule.createdAt,
    updatedAt: classSchedule.updatedAt,
    classStartTime: classSchedule.classStartTime,
    classEndTime: classSchedule.classEndTime,
    trainerId: classSchedule.trainerId,
  };
}

/**
 * Maps CreateClassScheduleDto to Prisma ClassSchedule create input
 */
export function toPrismaClassScheduleCreateInput(dto: CreateClassScheduleDto): Prisma.ClassScheduleCreateInput {
  const input: Prisma.ClassScheduleCreateInput = {
    name: dto.name,
    description: dto.description || null,
    classStartTime: dto.classStartTime,
    classEndTime: dto.classEndTime,
  };

  if (dto.trainerId) {
    input.trainer = {
      connect: { id: dto.trainerId }
    };
  }

  return input;
}

/**
 * Maps ClassScheduleEntity to response DTO
 */
export function toResponse(entity: ClassScheduleEntity) {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    classStartTime: entity.classStartTime,
    classEndTime: entity.classEndTime,
    trainerId: entity.trainerId,
    trainer: entity.trainer,
  };
}

export function toClassScheduleWithRelations(classSchedule: ClassScheduleWithRelations): ClassScheduleEntity {
  return {
    id: classSchedule.id,
    name: classSchedule.name,
    description: classSchedule.description || '',
    createdAt: classSchedule.createdAt,
    updatedAt: classSchedule.updatedAt,
    classBookings: classSchedule.classBookings.map(x => toClassBookingEntity(x)),
    classStartTime: classSchedule.classStartTime,
    classEndTime: classSchedule.classEndTime,
    trainerId: classSchedule.trainerId,
    trainer: classSchedule.trainer ? {
      id: classSchedule.trainer.id,
      firstName: classSchedule.trainer.firstName,
      lastName: classSchedule.trainer.lastName,
      email: classSchedule.trainer.email,
    } : null,
  };
};


