import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { TrainerEntity } from "../entities/trainer.entity";
import { toTrainerEntity, toTrainerEntityWithRelations, toPrismaTrainerCreateInput } from "../mapper/trainer.mapper";
import { CreateTrainerDto } from "../dto/create-trainer.dto";
import { TrainerFilterDto } from "../dto/trainer-filter.dto";
import { ERoleName } from "../../roles/enums/role.enum";
import { Prisma, TrainerAvailability, TrainerClientLinkStatus } from "@prisma/client";
import { IPaginate, PaginateOptions } from "../../../libs/models/paginate/pagimate.model";
import { dayOfWeekEnumToInt, parseTimeString } from "../utils/day-of-week.util";
import { TrainerAvailabilitySlotDto } from "../dto/trainer-availability.dto";
import { UserEntity } from "src/modules/user/entities/user.entity";
import { toUserEntityWithRelations } from "src/modules/user/mapper/user.mapper";
import { TrainerClientLinkView, toTrainerClientLinkView } from "../mapper/trainer-client-link.mapper";

@Injectable()
export class TrainerRepository {
  constructor(private readonly prisma: PrismaService) {}

    /**
     * Get trainer by user ID with relations
     */
    async getTrainerByUserId(userId: string): Promise<TrainerEntity | null> {
        if (!userId || userId.trim() === '') {
            return null;
        }
        try {
            const trainer = await this.prisma.user.findUnique({
                where: { id: userId.trim() },
                include: {
                    userRole: {
                        include: {
                            role: true,
                        },
                    },
                    userMembership: {
                        include: {
                            membership: true,
                        },
                    },
                },
            });
            if (!trainer) {
                return null;
            }
            
            // Check if user has TRAINER role
            const hasTrainerRole = trainer.userRole?.some(
                (ur) => String(ur.role.name) === String(ERoleName.TRAINER)
            );
            
            if (!hasTrainerRole) {
                return null;
            }
            
            return toTrainerEntityWithRelations(trainer);
        }
        catch (error) {
            Logger.error('Prisma error in getTrainerByUserId:', error);
            throw error;
        }
    }

    /**
     * Get trainer by email
     */
    async getTrainerByEmail(email: string): Promise<TrainerEntity | null> {
        const trainer = await this.prisma.user.findFirst({
            where: { email },
            include: {
                userRole: {
                    include: {
                        role: true,
                    },
                },
                userMembership: {
                    include: {
                        membership: true,
                    },
                },
            },
        });
        
        if (!trainer) {
            return null;
        }
        
        // Check if user has TRAINER role
        const hasTrainerRole = trainer.userRole?.some(
            (ur) => String(ur.role.name) === String(ERoleName.TRAINER)
        );
        
        if (!hasTrainerRole) {
            return null;
        }
        
        return toTrainerEntityWithRelations(trainer);
    }

    /**
     * Create a new trainer
     */
    async createTrainer(createTrainerDto: CreateTrainerDto & { password: string }): Promise<TrainerEntity> {
        // Find the TRAINER role in the database
        const trainerRole = await this.prisma.role.findUnique({
            where: { name: ERoleName.TRAINER },
        });

        if (!trainerRole) {
            throw new BadRequestException(`Role ${ERoleName.TRAINER} not found in database`);
        }

        // Create user and assign TRAINER role in a transaction
        const createdUserId = await this.prisma.$transaction(async (tx) => {
            // Create the trainer user
            const createdUser = await tx.user.create({
                data: toPrismaTrainerCreateInput(createTrainerDto),
            });

            // Assign TRAINER role to user
            await tx.userRole.create({
                data: {
                    userId: createdUser.id,
                    roleId: trainerRole.id,
                },
            });

            return createdUser.id;
        });

        // Fetch the created trainer with all relations
        const trainerWithRelations = await this.prisma.user.findUnique({
            where: { id: createdUserId },
            include: {
                userRole: {
                    include: {
                        role: true,
                    },
                },
                userMembership: {
                    include: {
                        membership: true,
                    },
                },
            },
        });

        if (!trainerWithRelations) {
            throw new BadRequestException('Failed to retrieve created trainer');
        }

        return toTrainerEntityWithRelations(trainerWithRelations);
    }

    /**
     * Update trainer
     */
    async updateTrainer(
        userId: string, 
        updateData: Partial<TrainerEntity> & { password?: string }
    ): Promise<TrainerEntity> {
        // Check if trainer exists
        const existingTrainer = await this.getTrainerByUserId(userId);
        if (!existingTrainer) {
            throw new BadRequestException(`Trainer with id ${userId} not found`);
        }

        // Update trainer fields
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                firstName: updateData.firstName,
                lastName: updateData.lastName,
                email: updateData.email,
                password: updateData.password ?? undefined,
                phone: updateData.phone ?? undefined,
                gender: updateData.gender ?? undefined,
                dob: updateData.dob ?? undefined,
                address: updateData.address ?? undefined,
                status: updateData.status ?? undefined,
                ptSessionPrice30: updateData.ptSessionPrice30 ?? undefined,
                ptSessionPrice60: updateData.ptSessionPrice60 ?? undefined,
                ptSessionPrice90: updateData.ptSessionPrice90 ?? undefined,
                trainerSpecialization: updateData.trainerSpecialization ?? undefined,
                trainerExperienceYears: updateData.trainerExperienceYears ?? undefined,
                trainerBiography: updateData.trainerBiography ?? undefined,
                trainerCertifications: updateData.trainerCertifications ?? undefined,
                trainerAreasOfExpertise: updateData.trainerAreasOfExpertise ?? undefined,
            },
        });

        // Fetch the updated trainer with all relations
        const trainerWithRelations = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                userRole: {
                    include: {
                        role: true,
                    },
                },
                userMembership: {
                    include: {
                        membership: true,
                    },
                },
            },
        });

        if (!trainerWithRelations) {
            throw new BadRequestException('Failed to retrieve updated trainer');
        }

        return toTrainerEntityWithRelations(trainerWithRelations);
    }

    /**
     * Delete trainer
     */
    async deleteTrainer(userId: string): Promise<void> {
        // Check if trainer exists
        const existingTrainer = await this.getTrainerByUserId(userId);
        if (!existingTrainer) {
            throw new BadRequestException(`Trainer with id ${userId} not found`);
        }

        // Delete trainer (cascade will handle userRole deletion)
        await this.prisma.user.delete({
            where: { id: userId },
        });
    }

    /**
     * Get paginated trainers
     */
    async getTrainerPaginate(
        filter: TrainerFilterDto,
        options: PaginateOptions
    ): Promise<IPaginate<TrainerEntity>> {
        const page = options.page || 1;
        const limit = options.limit || 10;
        const sort = options.sort || 'asc';
        const sortBy = options.sortBy || 'createdAt';
        const counted = options.counted ?? true;

        const { q: search, email, searchField } = filter;

        // Build where clause - must have TRAINER role
        const where: Prisma.UserWhereInput = {
            userRole: {
                some: {
                    role: {
                        name: ERoleName.TRAINER,
                    },
                },
            },
        };

        if (email) {
            where.email = email;
        }

        if (search) {
            if (searchField) {
                // Search in specific field
                if (searchField === 'firstName') {
                    where.firstName = { contains: search, mode: 'insensitive' };
                } else if (searchField === 'lastName') {
                    where.lastName = { contains: search, mode: 'insensitive' };
                } else if (searchField === 'email') {
                    where.email = { contains: search, mode: 'insensitive' };
                } else if (searchField === 'phone') {
                    where.phone = { contains: search, mode: 'insensitive' };
                }
            } else {
                // Search in firstName/lastName/email by default
                where.OR = [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ];
            }
        }

        // Build orderBy
        const allowedSortFields = ['id', 'firstName', 'lastName', 'email', 'createdAt'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
        
        let orderBy: Prisma.UserOrderByWithRelationInput;
        if (sortField === 'id') {
            orderBy = { id: sort };
        } else if (sortField === 'firstName') {
            orderBy = { firstName: sort };
        } else if (sortField === 'lastName') {
            orderBy = { lastName: sort };
        } else if (sortField === 'email') {
            orderBy = { email: sort };
        } else {
            orderBy = { createdAt: sort };
        }

        // Calculate skip
        const skip = (page - 1) * limit;

        // Execute queries with relations
        const [docs, totalDocs] = await Promise.all([
            this.prisma.user.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    userRole: {
                        include: {
                            role: true,
                        },
                    },
                    userMembership: {
                        include: {
                            membership: true,
                        },
                    },
                },
            }),
            counted ? this.prisma.user.count({ where }) : Promise.resolve(0),
        ]);

        // Map to entities with relations
        const mappedDocs = docs.map(toTrainerEntityWithRelations);

        // Calculate pagination metadata
        const totalPages = counted ? Math.ceil(totalDocs / limit) : 0;
        const currentPage = page;
        const nextPage = currentPage < totalPages ? currentPage + 1 : null;
        const previousPage = currentPage > 1 ? currentPage - 1 : null;
        const hasNext = nextPage !== null;
        const hasPrev = previousPage !== null;

        if (counted) {
            return {
                docs: mappedDocs,
                docsCount: mappedDocs.length,
                totalDocs,
                totalPages,
                currentPage,
                nextPage,
                previousPage,
                limit,
                hasNext,
                hasPrev,
            };
        } else {
            return {
                docs: mappedDocs,
                currentPage,
                nextPage,
                previousPage,
                limit,
                hasNext,
                hasPrev,
            };
        }
    }

    // ============================================
    // TRAINER AVAILABILITY (relational table)
    // ============================================

    /**
     * Get all availability slots for a trainer
     */
    async getAvailabilities(trainerId: string): Promise<TrainerAvailability[]> {
        return this.prisma.trainerAvailability.findMany({
            where: { trainerId },
            orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        });
    }

    /**
     * Bulk set availability: deletes all existing slots and creates new ones
     */
    async setAvailabilities(
        trainerId: string,
        slots: TrainerAvailabilitySlotDto[],
    ): Promise<TrainerAvailability[]> {
        await this.prisma.$transaction(async (tx) => {
            // Delete all existing availability for this trainer
            await tx.trainerAvailability.deleteMany({
                where: { trainerId },
            });

            // Create new slots
            if (slots.length > 0) {
                await tx.trainerAvailability.createMany({
                    data: slots.map((slot) => ({
                        trainerId,
                        dayOfWeek: dayOfWeekEnumToInt(slot.dayOfWeek),
                        startTime: parseTimeString(slot.startTime),
                        endTime: parseTimeString(slot.endTime),
                        isAvailable: slot.isAvailable ?? true,
                    })),
                });
            }
        });

        // Return the newly created slots
        return this.getAvailabilities(trainerId);
    }

    /**
     * Delete a single availability slot
     */
    async deleteAvailability(trainerId: string, slotId: string): Promise<void> {
        const slot = await this.prisma.trainerAvailability.findFirst({
            where: { id: slotId, trainerId },
        });

        if (!slot) {
            throw new BadRequestException(
                `Availability slot ${slotId} not found for trainer ${trainerId}`,
            );
        }

        await this.prisma.trainerAvailability.delete({
            where: { id: slotId },
        });
    }

    /**
     * Get a user with role relations and return null when the role does not match.
     */
    async getMemberByUserId(userId: string): Promise<UserEntity | null> {
        const user = await this.findUserByIdWithRoles(userId);
        if (!user || !this.hasRole(user, ERoleName.MEMBER)) {
            return null;
        }

        return toUserEntityWithRelations(user);
    }

    async findTrainerClientLinkById(
        linkId: string,
    ): Promise<TrainerClientLinkView | null> {
        const link = await this.prisma.trainerClientLink.findUnique({
            where: { id: linkId },
            include: this.trainerClientLinkInclude(),
        });

        return link ? toTrainerClientLinkView(link) : null;
    }

    async findActiveTrainerClientLink(
        trainerId: string,
        memberId: string,
    ): Promise<TrainerClientLinkView | null> {
        const link = await this.prisma.trainerClientLink.findFirst({
            where: {
                trainerId,
                memberId,
                status: TrainerClientLinkStatus.ACTIVE,
            },
            include: this.trainerClientLinkInclude(),
        });

        return link ? toTrainerClientLinkView(link) : null;
    }

    async listActiveTrainerClientLinks(
        trainerId: string,
    ): Promise<TrainerClientLinkView[]> {
        const links = await this.prisma.trainerClientLink.findMany({
            where: {
                trainerId,
                status: TrainerClientLinkStatus.ACTIVE,
            },
            orderBy: [{ linkedAt: 'desc' }],
            include: this.trainerClientLinkInclude(),
        });

        return links.map((link) => toTrainerClientLinkView(link));
    }

    async createTrainerClientLink(
        trainerId: string,
        memberId: string,
    ): Promise<TrainerClientLinkView> {
        const link = await this.prisma.trainerClientLink.create({
            data: {
                trainerId,
                memberId,
            },
            include: this.trainerClientLinkInclude(),
        });

        return toTrainerClientLinkView(link);
    }

    async endTrainerClientLink(
        linkId: string,
        endReason?: string,
    ): Promise<TrainerClientLinkView> {
        const link = await this.prisma.trainerClientLink.update({
            where: { id: linkId },
            data: {
                status: TrainerClientLinkStatus.ENDED,
                endedAt: new Date(),
                endReason: endReason ?? null,
            },
            include: this.trainerClientLinkInclude(),
        });

        return toTrainerClientLinkView(link);
    }

    private async findUserByIdWithRoles(userId: string) {
        if (!userId || userId.trim() === '') {
            return null;
        }

        return this.prisma.user.findUnique({
            where: { id: userId.trim() },
            include: {
                userRole: {
                    include: {
                        role: true,
                    },
                },
                userMembership: {
                    include: {
                        membership: true,
                    },
                },
            },
        });
    }

    private hasRole(
        user: {
            userRole?: { role: { name: string } }[];
        },
        roleName: ERoleName,
    ) {
        return (
            user.userRole?.some(
                (userRole) =>
                    String(userRole.role.name) === String(roleName),
            ) ?? false
        );
    }

    private trainerClientLinkInclude() {
        return {
            trainer: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                },
            },
            member: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                },
            },
        };
    }
}
