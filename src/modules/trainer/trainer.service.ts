import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainerRepository } from './repositories/trainer.repository';
import { TrainerEntity } from './entities/trainer.entity';
import { IPaginate, PaginateOptions } from '../../libs/models/paginate/pagimate.model';
import * as bcrypt from 'bcrypt';
import { JsonValue } from '@prisma/client/runtime/client';

interface TrainerFilterDto {
  q?: string;
  email?: string;
  searchField?: string;
}

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

    // Generate a default password (should be changed by trainer on first login)
    const password = await bcrypt.hash('trainer123', 10);

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

  /**
   * Get trainer available time
   */
  async getTrainerAvailableTime(id: string): Promise<JsonValue | null> {
    // Check if trainer exists
    await this.findOne(id);

    return this.trainerRepository.getTrainerAvailableTime(id);
  }

  /**
   * Update trainer available time
   */
  async updateTrainerAvailableTime(
    id: string,
    trainerAvailableTime: Record<string, any>[]
  ): Promise<TrainerEntity> {
    // Check if trainer exists
    const trainer = await this.findOne(id);

    return this.trainerRepository.updateTrainer(id, {
      trainerAvailableTime: trainerAvailableTime as any,
    });
  }

  /**
   * Update trainer available days
   */
  async updateTrainerAvailableDays(
    id: string,
    trainerAvailableDays: string[]
  ): Promise<TrainerEntity> {
    // Check if trainer exists
    await this.findOne(id);

    return this.trainerRepository.updateTrainer(id, {
      trainerAvailableDays,
    });
  }
}
