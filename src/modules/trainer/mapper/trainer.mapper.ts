import { TrainerEntity } from "../entities/trainer.entity";
import { User, Prisma } from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/client";
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
        trainerAvailableTime: user?.trainerAvailableTime as JsonValue | null,
        trainerAvailableDays: user?.trainerAvailableDays as string[] | null,
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

    // Extract roles
    if (user.userRole) {
        user.userRole.forEach((userRole) => {
            const role = userRole.role as unknown as { id: string; name: string; description: string | null };
            
            // Add role if not already added
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
            
            // Add membership with basic info
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
        createdAt: user.createdAt,
        trainerAvailableTime: user.trainerAvailableTime as JsonValue | null,
        trainerAvailableDays: user.trainerAvailableDays as string[] | null,
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
        trainerAvailableTime: dto.trainerAvailableTime as any ?? null,
        trainerAvailableDays: dto.trainerAvailableDays ?? [],
    };
}

/**
 * Maps TrainerEntity to response DTO (excludes sensitive fields)
 */
export function toTrainerResponse(entity: TrainerEntity) {
    const { password, ...rest } = entity;
    return rest;
}