import { TrainerEntity } from "../entities/trainer.entity";
import { User, Prisma } from "@prisma/client";
import { CreateTrainerDto } from "../dto/create-trainer.dto";
import { RoleInfo, MembershipInfo } from "../../user/entities/user.entity";

type TrainerWithRelations = Prisma.UserGetPayload<{
  include: {
    userRole: { include: { role: true } };
    userMembership: { include: { membership: true } };
  };
}>;

/**
 * Maps Prisma User model to TrainerEntity (basic mapping)
 */
export function toTrainerEntity(user: User): TrainerEntity {
    return {
        ...user,
        roles: [],
        memberships: [],
    };
}

/**
 * Maps Prisma User with relations to TrainerEntity
 */
export function toTrainerEntityWithRelations(user: TrainerWithRelations): TrainerEntity {
    // Extract unique roles
    const roleMap = new Map<string, RoleInfo>();

    if (user.userRole) {
        user.userRole.forEach((userRole) => {
            const role = userRole.role as unknown as { id: string; name: string; description: string | null };
            
            if (!roleMap.has(role.id)) {
                roleMap.set(role.id, {
                    id: role.id,
                    name: role.name,
                    description: role.description,
                });
            }
        });
    }

    // Extract memberships
    const memberships: MembershipInfo[] = [];
    if (user.userMembership) {
        user.userMembership.forEach((userMembership) => {
            const membership = userMembership.membership;
            
            memberships.push({
                id: membership.id,
                name: membership.name,
                description: membership.description,
            });
        });
    }

    return {
        id: user.id,
        password: user.password,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        dob: user.dob,
        address: user.address,
        status: user.status,
        avatarUrl: user.avatarUrl,
        ptSessionPrice30: user.ptSessionPrice30,
        ptSessionPrice60: user.ptSessionPrice60,
        ptSessionPrice90: user.ptSessionPrice90,
        trainerSpecialization: user.trainerSpecialization,
        trainerExperienceYears: user.trainerExperienceYears,
        trainerBiography: user.trainerBiography,
        trainerCertifications: user.trainerCertifications,
        trainerAreasOfExpertise: user.trainerAreasOfExpertise,
        createdAt: user.createdAt,
        roles: Array.from(roleMap.values()),
        memberships: memberships,
    };
}

/**
 * Maps CreateTrainerDto to Prisma User create input
 */
export function toPrismaTrainerCreateInput(dto: CreateTrainerDto & { password: string }) {
    return {
        password: dto.password,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone ?? null,
        gender: dto.gender ?? null,
        dob: dto.dob ?? null,
        address: dto.address ?? null,
        status: dto.status ?? null,
        avatarUrl: null,
        ptSessionPrice30: dto.ptSessionPrice30 ?? 150000,
        ptSessionPrice60: dto.ptSessionPrice60 ?? 250000,
        ptSessionPrice90: dto.ptSessionPrice90 ?? 350000,
        trainerSpecialization: dto.specialization ?? null,
        trainerExperienceYears: dto.experienceYears ?? null,
        trainerBiography: dto.biography ?? null,
        trainerCertifications: dto.certifications ?? [],
        trainerAreasOfExpertise: dto.areasOfExpertise ?? [],
    };
}

/**
 * Maps TrainerEntity to response DTO (excludes sensitive fields)
 */
export function toTrainerResponse(entity: TrainerEntity) {
    const { password, ...rest } = entity;
    return rest;
}
