import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainerRepository } from './repositories/trainer.repository';
import { TrainerEntity } from './entities/trainer.entity';
import { IPaginate, PaginateOptions } from '../../libs/models/paginate/pagimate.model';
import * as bcrypt from 'bcrypt';
import { TrainerAvailabilitySlotDto } from './dto/trainer-availability.dto';
import { TrainerFilterDto } from './dto/trainer-filter.dto';
import {
  DayOfWeek,
  TrainerAvailability,
  TrainerClientLinkStatus,
} from '@prisma/client';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import {
  CreateTrainerClientLinkDto,
  EndTrainerClientLinkDto,
} from './dto/trainer-client-link.dto';
import {
  TrainerClientLinkView,
} from './mapper/trainer-client-link.mapper';
import {
  dayOfWeekEnumToInt,
  formatTimeToString,
} from './utils/day-of-week.util';
import { AppCacheService } from '../../libs/cache/cache.service';
import {
  buildTrainerAvailabilityKey,
  buildTrainerInvalidationTags,
  buildTrainerListKey,
  buildTrainerDetailKey,
  TRAINER_AVAILABILITY_TTL_SECONDS,
  TRAINER_LIST_TTL_SECONDS,
  trainerAvailabilityTags,
  trainerDetailTags,
  trainerListTags,
} from './trainer.cache';

@Injectable()
export class TrainerService {
  constructor(
    private readonly trainerRepository: TrainerRepository,
    private readonly appCacheService: AppCacheService,
  ) {}

  /**
   * Create a new trainer
   */
  async create(createTrainerDto: CreateTrainerDto): Promise<TrainerEntity> {
    // Check if trainer already exists
    const existingTrainer = await this.trainerRepository.getTrainerByEmail(createTrainerDto.email);
    if (existingTrainer) {
      throw new BadRequestException('Trainer with this email already exists');
    }

    // Hash the admin-provided password
    const password = await bcrypt.hash(createTrainerDto.password, 10);

    const created = await this.trainerRepository.createTrainer({
      ...createTrainerDto,
      password,
    });
    await this.appCacheService.invalidateTags(
      buildTrainerInvalidationTags({
        trainerId: created.id,
        includeList: true,
        includeAvailability: true,
      }),
    );

    return created;
  }

  /**
   * Get paginated trainers
   */
  async getTrainerPaginate(
    paginateRequest: PaginateOptions,
    filter: TrainerFilterDto,
    options: { counted?: boolean }
  ): Promise<IPaginate<TrainerEntity>> {
    return this.appCacheService.remember(
      buildTrainerListKey(paginateRequest, filter, options.counted),
      () =>
        this.trainerRepository.getTrainerPaginate(filter, {
          ...paginateRequest,
          counted: options.counted,
        }),
      {
        ttlSeconds: TRAINER_LIST_TTL_SECONDS,
        tags: trainerListTags(),
      },
    );
  }

  /**
   * Find one trainer by id
   */
  async findOne(id: string): Promise<TrainerEntity> {
    const trainer = await this.appCacheService.remember(
      buildTrainerDetailKey(id),
      () => this.trainerRepository.getTrainerByUserId(id),
      {
        ttlSeconds: TRAINER_LIST_TTL_SECONDS,
        tags: trainerDetailTags(id),
      },
    );
    if (!trainer) {
      throw new NotFoundException(`Trainer with id ${id} not found`);
    }
    return trainer;
  }

  /**
   * Update trainer
   */
  async update(id: string, updateTrainerDto: UpdateTrainerDto): Promise<TrainerEntity> {
    // Check if trainer exists
    await this.findOne(id);

    // Check if email is being updated and if it's already taken by another trainer
    if (updateTrainerDto.email) {
      const existingTrainer = await this.trainerRepository.getTrainerByEmail(updateTrainerDto.email);
      if (existingTrainer && existingTrainer.id !== id) {
        throw new BadRequestException('Email is already taken by another trainer');
      }
    }

    // Hash password if provided
    let hashedPassword: string | undefined;
    if (updateTrainerDto.password) {
      hashedPassword = await bcrypt.hash(updateTrainerDto.password, 10);
    }

    // Prepare update data
    const {
      password,
      specialization,
      experienceYears,
      biography,
      certifications,
      areasOfExpertise,
      ...otherData
    } = updateTrainerDto;
    const updateData: Partial<TrainerEntity> & { password?: string } = {
      ...otherData,
      trainerSpecialization: specialization,
      trainerExperienceYears: experienceYears,
      trainerBiography: biography,
      trainerCertifications: certifications,
      trainerAreasOfExpertise: areasOfExpertise,
      ...(hashedPassword && { password: hashedPassword }),
    };

    const updated = await this.trainerRepository.updateTrainer(id, updateData);
    await this.appCacheService.invalidateTags(
      buildTrainerInvalidationTags({
        trainerId: id,
        includeList: true,
        includeAvailability: true,
      }),
    );

    return updated;
  }

  /**
   * Remove trainer
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if trainer exists
    await this.findOne(id);

    // Delete trainer
    await this.trainerRepository.deleteTrainer(id);
    await this.appCacheService.invalidateTags(
      buildTrainerInvalidationTags({
        trainerId: id,
        includeList: true,
        includeAvailability: true,
      }),
    );

    return { message: `Trainer ${id} deleted successfully` };
  }

  // ============================================
  // AVAILABILITY (relational TrainerAvailability table)
  // ============================================

  /**
   * Get all availability slots for a trainer
   */
  async getAvailabilities(id: string): Promise<TrainerAvailability[]> {
    await this.findOne(id);
    return this.appCacheService.remember(
      buildTrainerAvailabilityKey(id),
      () => this.trainerRepository.getAvailabilities(id),
      {
        ttlSeconds: TRAINER_AVAILABILITY_TTL_SECONDS,
        tags: trainerAvailabilityTags(id),
      },
    );
  }

  /**
   * Bulk set availability slots (delete all existing, create new)
   */
  async setAvailabilities(
    id: string,
    slots: TrainerAvailabilitySlotDto[],
  ): Promise<TrainerAvailability[]> {
    await this.findOne(id);
    const availability = await this.trainerRepository.setAvailabilities(id, slots);
    await this.appCacheService.invalidateTags(
      buildTrainerInvalidationTags({
        trainerId: id,
        includeAvailability: true,
      }),
    );

    return availability;
  }

  /**
   * Delete a single availability slot
   */
  async deleteAvailability(trainerId: string, slotId: string): Promise<void> {
    await this.findOne(trainerId);
    await this.trainerRepository.deleteAvailability(trainerId, slotId);
    await this.appCacheService.invalidateTags(
      buildTrainerInvalidationTags({
        trainerId,
        includeAvailability: true,
      }),
    );
  }

  async createTrainerClientLink(
    trainerId: string,
    dto: CreateTrainerClientLinkDto,
  ): Promise<TrainerClientLinkView> {
    await this.ensureTrainerExists(trainerId);
    await this.ensureMemberExists(dto.memberId);

    const existingLink = await this.trainerRepository.findActiveTrainerClientLink(
      trainerId,
      dto.memberId,
    );
    if (existingLink) {
      throw new ConflictException(
        'An active trainer-client link already exists for this member',
      );
    }

    return this.trainerRepository.createTrainerClientLink(
      trainerId,
      dto.memberId,
    );
  }

  async endTrainerClientLink(
    trainerId: string,
    linkId: string,
    dto: EndTrainerClientLinkDto,
  ): Promise<TrainerClientLinkView> {
    await this.ensureTrainerExists(trainerId);

    const link = await this.trainerRepository.findTrainerClientLinkById(linkId);
    if (!link || link.trainerId !== trainerId) {
      throw new NotFoundException(
        `Trainer client link ${linkId} not found for trainer ${trainerId}`,
      );
    }

    if (link.status !== TrainerClientLinkStatus.ACTIVE) {
      throw new BadRequestException(
        'Only active trainer-client links can be ended',
      );
    }

    return this.trainerRepository.endTrainerClientLink(linkId, dto.endReason);
  }

  async listTrainerClientLinks(
    user: RequestUser,
  ): Promise<TrainerClientLinkView[]> {
    await this.ensureTrainerExists(user.sub);
    return this.trainerRepository.listActiveTrainerClientLinks(user.sub);
  }

  async findActiveTrainerClientLink(
    trainerId: string,
    memberId: string,
  ): Promise<TrainerClientLinkView | null> {
    return this.trainerRepository.findActiveTrainerClientLink(trainerId, memberId);
  }

  /**
   * Check if trainer is within working hours for a given day and time range.
   * This is Layer 1 ONLY — working hours check.
   * Schedule conflict checking (Layer 2) is handled by ClassScheduleService.
   */
  async isWithinWorkingHours(
    trainerId: string,
    dayOfWeek: DayOfWeek,
    startTime: Date,
    endTime: Date,
  ): Promise<{ withinHours: boolean; reason?: string }> {
    const dayInt = dayOfWeekEnumToInt(dayOfWeek);

    const availabilities = await this.trainerRepository.getAvailabilities(trainerId);

    // Filter to the requested day + isAvailable = true
    const daySlots = availabilities.filter(
      (a) => a.dayOfWeek === dayInt && a.isAvailable,
    );

    if (daySlots.length === 0) {
      return {
        withinHours: false,
        reason: `Trainer does not work on ${dayOfWeek}`,
      };
    }

    // Check if the requested time window fits within any available slot
    const requestStartMinutes = startTime.getUTCHours() * 60 + startTime.getUTCMinutes();
    const requestEndMinutes = endTime.getUTCHours() * 60 + endTime.getUTCMinutes();

    for (const slot of daySlots) {
      const slotStartMinutes = slot.startTime.getUTCHours() * 60 + slot.startTime.getUTCMinutes();
      const slotEndMinutes = slot.endTime.getUTCHours() * 60 + slot.endTime.getUTCMinutes();

      if (requestStartMinutes >= slotStartMinutes && requestEndMinutes <= slotEndMinutes) {
        return { withinHours: true };
      }
    }

    // Build reason with available slots info
    const slotsInfo = daySlots
      .map((s) => `${formatTimeToString(s.startTime)}-${formatTimeToString(s.endTime)}`)
      .join(', ');

    return {
      withinHours: false,
      reason: `Trainer works ${slotsInfo} on ${dayOfWeek}, requested ${formatTimeToString(startTime)}-${formatTimeToString(endTime)}`,
    };
  }

  private async ensureTrainerExists(trainerId: string): Promise<void> {
    const trainer = await this.trainerRepository.getTrainerByUserId(trainerId);
    if (!trainer) {
      throw new NotFoundException(`Trainer with id ${trainerId} not found`);
    }
  }

  private async ensureMemberExists(memberId: string): Promise<void> {
    const member = await this.trainerRepository.getMemberByUserId(memberId);
    if (!member) {
      throw new NotFoundException(`Member with id ${memberId} not found`);
    }
  }
}
