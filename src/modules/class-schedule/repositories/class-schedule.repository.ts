import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { ClassScheduleEntity } from '../entities/class-schedule.entity';
import { CreateClassScheduleDto } from '../dto/create-class-schedule.dto';
import { UpdateClassScheduleDto } from '../dto/update-class-schedule.dto';
import { toClassScheduleEntity } from '../mapper/class-schedule.mapper';
import {
  IPaginate,
  PaginateOptions,
} from '../../../libs/models/paginate/pagimate.model';
import { Prisma, DayOfWeek } from '@prisma/client';

export interface ClassScheduleFilterDto {
  q?: string;
  searchField?: string;
  dayOfWeek?: DayOfWeek;
  trainerId?: string;
  classId?: string;
  isActive?: boolean;
}

@Injectable()
export class ClassScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get class schedule by ID with gymClass relation
   */
  async getById(id: string): Promise<ClassScheduleEntity | null> {
    if (!id || id.trim() === '') {
      return null;
    }

    try {
      const classSchedule = await this.prisma.classSchedule.findUnique({
        where: { id: id.trim() },
        include: { gymClass: true, scheduleDays: true },
      });

      if (!classSchedule) {
        return null;
      }

      return toClassScheduleEntity(classSchedule);
    } catch (error) {
      console.error('Prisma error in getById:', error);
      throw error;
    }
  }

  /**
   * Create a new class schedule
   */
  async create(
    createDto: CreateClassScheduleDto,
  ): Promise<ClassScheduleEntity> {
    // Determine the days to create (support both legacy dayOfWeek and new daysOfWeek[])
    const daysOfWeek =
      createDto.daysOfWeek && createDto.daysOfWeek.length > 0
        ? createDto.daysOfWeek
        : createDto.dayOfWeek
          ? [createDto.dayOfWeek]
          : [];

    // Create schedule with scheduleDays relation
    const createdClassSchedule = await this.prisma.classSchedule.create({
      data: {
        classId: createDto.classId,
        trainerId: createDto.trainerId,
        // Keep legacy dayOfWeek for backward compatibility (first day in array)
        dayOfWeek: daysOfWeek.length > 0 ? (daysOfWeek[0] as DayOfWeek) : null,
        startTime: createDto.startTime,
        endTime: createDto.endTime,
        validFrom: createDto.validFrom ?? null,
        validUntil: createDto.validUntil ?? null,
        location: createDto.location ?? null,
        capacity: createDto.capacity ?? 20,
        isActive: createDto.isActive ?? true,
        // Create ScheduleDay records for multi-day support
        scheduleDays: {
          create: daysOfWeek.map((day) => ({ dayOfWeek: day as DayOfWeek })),
        },
      },
      include: { gymClass: true, scheduleDays: true },
    });

    return toClassScheduleEntity(createdClassSchedule);
  }

  /**
   * Update class schedule
   */
  async update(
    id: string,
    updateDto: UpdateClassScheduleDto,
  ): Promise<ClassScheduleEntity> {
    // Check if class schedule exists
    const existing = await this.prisma.classSchedule.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new BadRequestException(`ClassSchedule with id ${id} not found`);
    }

    // Prepare update data
    const updateData: Prisma.ClassScheduleUpdateInput = {};

    if (updateDto.classId !== undefined) {
      updateData.gymClass = { connect: { id: updateDto.classId } };
    }

    if (updateDto.trainerId !== undefined) {
      updateData.trainer = { connect: { id: updateDto.trainerId } };
    }

    if (updateDto.dayOfWeek !== undefined) {
      updateData.dayOfWeek = updateDto.dayOfWeek as DayOfWeek;
    }

    if (updateDto.startTime !== undefined) {
      updateData.startTime = updateDto.startTime;
    }

    if (updateDto.endTime !== undefined) {
      updateData.endTime = updateDto.endTime;
    }

    if (updateDto.validFrom !== undefined) {
      updateData.validFrom = updateDto.validFrom;
    }

    if (updateDto.validUntil !== undefined) {
      updateData.validUntil = updateDto.validUntil;
    }

    if (updateDto.location !== undefined) {
      updateData.location = updateDto.location;
    }

    if (updateDto.capacity !== undefined) {
      updateData.capacity = updateDto.capacity;
    }

    if (updateDto.isActive !== undefined) {
      updateData.isActive = updateDto.isActive;
    }

    // Update class schedule
    const updatedClassSchedule = await this.prisma.classSchedule.update({
      where: { id },
      data: updateData,
      include: { gymClass: true, scheduleDays: true },
    });

    return toClassScheduleEntity(updatedClassSchedule);
  }

  /**
   * Delete class schedule
   */
  async delete(id: string): Promise<void> {
    // Check if class schedule exists
    const existing = await this.prisma.classSchedule.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new BadRequestException(`ClassSchedule with id ${id} not found`);
    }

    // Delete class schedule
    await this.prisma.classSchedule.delete({
      where: { id },
    });
  }

  /**
   * Get paginated class schedules
   */
  async getPaginate(
    filter: ClassScheduleFilterDto,
    options: PaginateOptions,
  ): Promise<IPaginate<ClassScheduleEntity>> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const sort = options.sort || 'asc';
    const sortBy = options.sortBy || 'createdAt';
    const counted = options.counted ?? true;

    const {
      q: search,
      searchField,
      dayOfWeek,
      trainerId,
      classId,
      isActive,
    } = filter;

    // Build where clause
    const where: Prisma.ClassScheduleWhereInput = {};

    if (dayOfWeek) {
      where.dayOfWeek = dayOfWeek;
    }

    if (trainerId) {
      where.trainerId = trainerId;
    }

    if (classId) {
      where.classId = classId;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      if (searchField) {
        // Search in specific field
        if (searchField === 'location') {
          where.location = { contains: search, mode: 'insensitive' };
        } else if (searchField === 'className') {
          where.gymClass = {
            className: { contains: search, mode: 'insensitive' },
          };
        }
      } else {
        // Search in location and gymClass.className by default
        where.OR = [
          { location: { contains: search, mode: 'insensitive' } },
          {
            gymClass: { className: { contains: search, mode: 'insensitive' } },
          },
        ];
      }
    }

    // Build orderBy
    const allowedSortFields = [
      'id',
      'dayOfWeek',
      'startTime',
      'createdAt',
      'updatedAt',
      'capacity',
    ];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    let orderBy: Prisma.ClassScheduleOrderByWithRelationInput;
    if (sortField === 'id') {
      orderBy = { id: sort };
    } else if (sortField === 'dayOfWeek') {
      orderBy = { dayOfWeek: sort };
    } else if (sortField === 'startTime') {
      orderBy = { startTime: sort };
    } else if (sortField === 'createdAt') {
      orderBy = { createdAt: sort };
    } else if (sortField === 'updatedAt') {
      orderBy = { updatedAt: sort };
    } else if (sortField === 'capacity') {
      orderBy = { capacity: sort };
    } else {
      orderBy = { createdAt: sort };
    }

    // Calculate skip
    const skip = (page - 1) * limit;

    // Execute queries with gymClass relation
    const [docs, totalDocs] = await Promise.all([
      this.prisma.classSchedule.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { gymClass: true },
      }),
      counted ? this.prisma.classSchedule.count({ where }) : Promise.resolve(0),
    ]);

    // Map to entities
    const mappedDocs = docs.map(toClassScheduleEntity);

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

  /**
   * Get schedules by day of week
   */
  async getByDayOfWeek(dayOfWeek: DayOfWeek): Promise<ClassScheduleEntity[]> {
    const schedules = await this.prisma.classSchedule.findMany({
      where: { dayOfWeek, isActive: true },
      include: { gymClass: true },
      orderBy: { startTime: 'asc' },
    });

    return schedules.map(toClassScheduleEntity);
  }

  /**
   * Get schedules by trainer
   */
  async getByTrainerId(trainerId: string): Promise<ClassScheduleEntity[]> {
    const schedules = await this.prisma.classSchedule.findMany({
      where: { trainerId },
      include: { gymClass: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return schedules.map(toClassScheduleEntity);
  }

  /**
   * Check if a schedule conflicts with existing trainer schedules
   * Uses time overlap logic: (start1 < end2) AND (end1 > start2)
   * @param trainerId - The trainer to check conflicts for
   * @param dayOfWeek - The day of the week
   * @param startTime - Start time of the new schedule
   * @param endTime - End time of the new schedule
   * @param excludeScheduleId - Optional schedule ID to exclude (for updates)
   * @returns true if there is a conflict, false otherwise
   */
  async checkScheduleConflict(
    trainerId: string,
    dayOfWeek: DayOfWeek,
    startTime: Date,
    endTime: Date,
    excludeScheduleId?: string,
  ): Promise<boolean> {
    const conflictingSchedules = await this.getConflictingSchedules(
      trainerId,
      dayOfWeek,
      startTime,
      endTime,
      excludeScheduleId,
    );

    return conflictingSchedules.length > 0;
  }

  /**
   * Get all schedules that conflict with the given time slot
   * @param trainerId - The trainer to check conflicts for
   * @param dayOfWeek - The day of the week
   * @param startTime - Start time of the new schedule
   * @param endTime - End time of the new schedule
   * @param excludeScheduleId - Optional schedule ID to exclude (for updates)
   * @returns Array of conflicting schedules
   */
  async getConflictingSchedules(
    trainerId: string,
    dayOfWeek: DayOfWeek,
    startTime: Date,
    endTime: Date,
    excludeScheduleId?: string,
  ): Promise<ClassScheduleEntity[]> {
    // Time overlap condition: (start1 < end2) AND (end1 > start2)
    // This catches all overlap cases:
    // - New schedule starts during existing
    // - New schedule ends during existing
    // - New schedule completely contains existing
    // - Existing completely contains new schedule
    const where: Prisma.ClassScheduleWhereInput = {
      trainerId,
      dayOfWeek,
      isActive: true,
      AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
    };

    // Exclude current schedule when updating
    if (excludeScheduleId) {
      where.id = { not: excludeScheduleId };
    }

    const conflicts = await this.prisma.classSchedule.findMany({
      where,
      include: { gymClass: true },
      orderBy: { startTime: 'asc' },
    });

    return conflicts.map(toClassScheduleEntity);
  }
}
