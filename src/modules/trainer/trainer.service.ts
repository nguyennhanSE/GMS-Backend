import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainerRepository } from './repositories/trainer.repository';
import { TrainerEntity } from './entities/trainer.entity';
import { IPaginate, PaginateOptions } from '../../libs/models/paginate/pagimate.model';
import * as bcrypt from 'bcrypt';
import { TrainerAvailabilitySlotDto } from './dto/trainer-availability.dto';
import { TrainerFilterDto } from './dto/trainer-filter.dto';
import { DayOfWeek, TrainerAvailability } from '@prisma/client';
import {
  dayOfWeekEnumToInt,
  formatTimeToString,
} from './utils/day-of-week.util';

@Injectable()
export class TrainerService {
  constructor(private readonly trainerRepository: TrainerRepository) {}

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

    return this.trainerRepository.createTrainer({
      ...createTrainerDto,
      password,
    });
  }

  /**
   * Get paginated trainers
   */
  async getTrainerPaginate(
    paginateRequest: PaginateOptions,
    filter: TrainerFilterDto,
    options: { counted?: boolean }
  ): Promise<IPaginate<TrainerEntity>> {
    return this.trainerRepository.getTrainerPaginate(filter, {
      ...paginateRequest,
      counted: options.counted,
    });
  }

  /**
   * Find one trainer by id
   */
  async findOne(id: string): Promise<TrainerEntity> {
    const trainer = await this.trainerRepository.getTrainerByUserId(id);
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
    const { password, ...otherData } = updateTrainerDto;
    const updateData: Partial<TrainerEntity> & { password?: string } = {
      ...otherData,
      ...(hashedPassword && { password: hashedPassword }),
    };

    return this.trainerRepository.updateTrainer(id, updateData);
  }

  /**
   * Remove trainer
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if trainer exists
    await this.findOne(id);

    // Delete trainer
    await this.trainerRepository.deleteTrainer(id);

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
    return this.trainerRepository.getAvailabilities(id);
  }

  /**
   * Bulk set availability slots (delete all existing, create new)
   */
  async setAvailabilities(
    id: string,
    slots: TrainerAvailabilitySlotDto[],
  ): Promise<TrainerAvailability[]> {
    await this.findOne(id);
    return this.trainerRepository.setAvailabilities(id, slots);
  }

  /**
   * Delete a single availability slot
   */
  async deleteAvailability(trainerId: string, slotId: string): Promise<void> {
    await this.findOne(trainerId);
    return this.trainerRepository.deleteAvailability(trainerId, slotId);
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
}
