import { Prisma } from '@prisma/client';
import { toUserEntity } from '../../user/mapper/user.mapper';
import { TrainerBookingEntity } from '../entities/trainer-booking.entity';

type TrainerBookingWithRelations = Prisma.TrainerBookingGetPayload<{
  include: {
    member: true;
    trainer: true;
  };
}>;

type TrainerProfileUser = Prisma.UserGetPayload<{
  include: {
    userRole: { include: { role: true } };
    userMembership: { include: { membership: true } };
    trainerAvailabilities: true;
  };
}>;

export function toTrainerBookingEntity(
  booking: TrainerBookingWithRelations,
): TrainerBookingEntity {
  return {
    id: booking.id,
    memberId: booking.memberId,
    trainerId: booking.trainerId,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    price: Number(booking.price),
    currency: booking.currency,
    paymentId: booking.paymentId,
    notes: booking.notes,
    cancelledAt: booking.cancelledAt,
    cancelReason: booking.cancelReason,
    rescheduledFromBookingId: booking.rescheduledFromBookingId,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    member: booking.member ? toUserEntity(booking.member) : null,
    trainer: booking.trainer ? toUserEntity(booking.trainer) : null,
  };
}

export function toTrainerProfileResponse(
  trainer: TrainerProfileUser,
  options: {
    pricing: Record<number, number>;
    availabilitySlots: Array<{
      startAt: Date;
      endAt: Date;
      durations: number[];
    }>;
    canBook: boolean;
  },
) {
  return {
    id: trainer.id,
    firstName: trainer.firstName,
    lastName: trainer.lastName,
    email: trainer.email,
    avatarUrl: trainer.avatarUrl,
    specialization: trainer.trainerSpecialization,
    experience: trainer.trainerExperienceYears,
    biography: trainer.trainerBiography,
    certifications: trainer.trainerCertifications,
    areasOfExpertise: trainer.trainerAreasOfExpertise,
    pricing: options.pricing,
    availabilityGuidance:
      'Select a slot that fits inside the trainer working hours and does not overlap existing bookings.',
    canBook: options.canBook,
    availableSlots: options.availabilitySlots,
  };
}

export function toTrainerPricing(
  trainer: Pick<
    TrainerProfileUser,
    'ptSessionPrice30' | 'ptSessionPrice60' | 'ptSessionPrice90'
  >,
): Record<number, number> {
  return {
    30: trainer.ptSessionPrice30,
    60: trainer.ptSessionPrice60,
    90: trainer.ptSessionPrice90,
  };
}

export function toTrainerBookingResponse(entity: TrainerBookingEntity) {
  return {
    id: entity.id,
    memberId: entity.memberId,
    trainerId: entity.trainerId,
    startAt: entity.startAt,
    endAt: entity.endAt,
    status: entity.status,
    price: entity.price,
    currency: entity.currency,
    paymentId: entity.paymentId ?? null,
    notes: entity.notes ?? null,
    cancelledAt: entity.cancelledAt ?? null,
    cancelReason: entity.cancelReason ?? null,
    rescheduledFromBookingId: entity.rescheduledFromBookingId ?? null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    member: entity.member
      ? {
          id: entity.member.id,
          firstName: entity.member.firstName,
          lastName: entity.member.lastName,
          email: entity.member.email,
          phone: entity.member.phone,
          status: entity.member.status,
          avatarUrl: entity.member.avatarUrl,
        }
      : null,
    trainer: entity.trainer
      ? {
          id: entity.trainer.id,
          firstName: entity.trainer.firstName,
          lastName: entity.trainer.lastName,
          email: entity.trainer.email,
          phone: entity.trainer.phone,
          status: entity.trainer.status,
          avatarUrl: entity.trainer.avatarUrl,
        }
      : null,
  };
}
