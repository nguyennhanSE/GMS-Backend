import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ClassScheduleEntity } from './entities/class-schedule.entity';
import { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';
import { ClassScheduleRepository, ClassScheduleFilterDto } from './repositories/class-schedule.repository';
import { IPaginate, PaginateOptions } from '../../libs/models/paginate/pagimate.model';

@Injectable()
export class ClassScheduleService {
  constructor(private readonly classScheduleRepository: ClassScheduleRepository) {}

  /**
   * Create a new class schedule
   */
  async create(createClassScheduleDto: CreateClassScheduleDto): Promise<ClassScheduleEntity> {
    // Check if class schedule with same name already exists
    const existing = await this.classScheduleRepository.getByName(createClassScheduleDto.name);
    if (existing) {
      throw new BadRequestException('Class schedule with this name already exists');
    }

    return this.classScheduleRepository.create(createClassScheduleDto);
  }

  /**
   * Get paginated class schedules
   */
  async findAll(
    paginateRequest: PaginateOptions,
    filter: ClassScheduleFilterDto,
    options: { counted?: boolean }
  ): Promise<IPaginate<ClassScheduleEntity>> {
    return this.classScheduleRepository.getPaginate(filter, {
      ...paginateRequest,
      counted: options.counted,
    });
  }

  /**
   * Find one class schedule by id
   */
  async findOne(id: string): Promise<ClassScheduleEntity> {
    const classSchedule = await this.classScheduleRepository.getById(id);
    if (!classSchedule) {
      throw new NotFoundException(`Class schedule with id ${id} not found`);
    }
    return classSchedule;
  }

  /**
   * Update class schedule
   */
  async update(id: string, updateClassScheduleDto: UpdateClassScheduleDto): Promise<ClassScheduleEntity> {
    // Check if class schedule exists
    await this.findOne(id);

    // Check if name is being updated and if it's already taken by another class schedule
    if (updateClassScheduleDto.name) {
      const existing = await this.classScheduleRepository.getByName(updateClassScheduleDto.name);
      if (existing && existing.id !== id) {
        throw new BadRequestException('Name is already taken by another class schedule');
      }
    }

    return this.classScheduleRepository.update(id, updateClassScheduleDto);
  }

  /**
   * Remove class schedule
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if class schedule exists
    await this.findOne(id);

    // Delete class schedule
    await this.classScheduleRepository.delete(id);

    return { message: `Class schedule ${id} deleted successfully` };
  }
}
