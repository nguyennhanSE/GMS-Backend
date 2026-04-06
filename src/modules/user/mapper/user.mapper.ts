import { MembershipInfo, RoleInfo, UserEntity } from '../entities/user.entity';
import { Prisma } from '@prisma/client';
import { CreateUserDto } from '../dto/user.dto';

type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    userRole: { include: { role: true } };
    userMembership: { include: { membership: true } };
  };
}>;

type UserModel = Prisma.UserGetPayload<Record<string, never>>;

/**
 * Maps Prisma User model to UserEntity
 */
export function toUserEntity(user: UserModel): UserEntity {
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
    roles: [],
    memberships: [],
  };
}

/**
 * Maps Prisma User with relations (userRole, role, userMembership, membership) to UserEntity
 */
export function toUserEntityWithRelations(user: UserWithRelations): UserEntity {
  // Extract unique roles
  const roleMap = new Map<string, RoleInfo>();

  // Extract roles
  if (user.userRole) {
    user.userRole.forEach((userRole) => {
      const role = userRole.role as unknown as {
        id: string;
        name: string;
        description: string | null;
      };

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
 * Maps CreateUserDto to Prisma User create input
 */
export function toPrismaUserCreateInput(
  dto: CreateUserDto & { password: string; status?: string | null },
) {
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
    trainerSpecialization: null,
    trainerExperienceYears: null,
    trainerBiography: null,
    trainerCertifications: [],
    trainerAreasOfExpertise: [],
  };
}

/**
 * Maps UserMembership with details to enriched membership info
 * This includes status, dates, and denormalized fields
 */
type UserMembershipWithMembership = Prisma.UserMembershipGetPayload<{ include: { membership: true } }>;
export function toUserMembershipInfo(userMembership: UserMembershipWithMembership): MembershipInfo {
  return {
    id: userMembership.membership.id,
    name: userMembership.membership.name,
    description: userMembership.membership.description,
  };
}

/**
 * Maps UserEntity to response DTO (excludes sensitive fields)
 */
export function toResponse(entity: UserEntity) {
  const { password, ...rest } = entity;
  return rest;
}

