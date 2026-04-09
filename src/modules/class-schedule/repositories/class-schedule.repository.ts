import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import {
  ClassScheduleEntity,
  ClassScheduleOccurrenceEntity,
} from '../entities/class-schedule.entity';
import { CreateClassScheduleDto } from '../dto/create-class-schedule.dto';
import { UpdateClassScheduleDto } from '../dto/update-class-schedule.dto';
import { toClassScheduleEntity } from '../mapper/class-schedule.mapper';
import {
  IPaginate,
  PaginateOptions,
} from '../../../libs/models/paginate/pagimate.model';
import { ExceptionType, Prisma, DayOfWeek, ScheduleException } from '@prisma/client';
import { toScheduleExceptionEntity } from '../mapper/schedule-exception.mapper';

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

  private withOptionalExceptions<T>(
    schedule: T,
  ): T & { scheduleExceptions?: ScheduleException[] } {
    return schedule as T & { scheduleExceptions?: ScheduleException[] };
  }

  /**
   * Get class schedule by ID with gymClass relation and optional booking count
   */
  async getById(
    id: string,
    targetDate?: Date,
  ): Promise<ClassScheduleEntity | null> {
    if (!id || id.trim() === '') {
      return null;
    }

    try {
      const classSchedule = await this.prisma.classSchedule.findUnique({
        where: { id: id.trim() },
        include: {
          gymClass: true,
          scheduleDays: true,
          ...(targetDate
            ? {
                scheduleExceptions: {
                  where: {
                    exceptionDate: this.normalizeDateOnly(targetDate),
                  },
                  take: 1,
                },
              }
            : {}),
        },
      });

      if (!classSchedule) {
        return null;
      }

      const entity = toClassScheduleEntity(classSchedule);

      // Resolve date: use provided date, or auto-resolve to next occurrence
      const resolvedDate =
        targetDate ??
        (entity.dayOfWeek
          ? this.getNextOccurrence(entity.dayOfWeek)
          : undefined);

      if (resolvedDate) {
        entity.bookingsCount = await this.countBookingsForDate(
          id,
          resolvedDate,
        );
      }

      if (targetDate) {
        const scheduleWithExceptions = this.withOptionalExceptions(classSchedule);
        this.applyOccurrence(
          entity,
          scheduleWithExceptions.scheduleExceptions ?? [],
          targetDate,
        );
      }

      return entity;
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
    targetDate?: Date,
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
        include: {
          gymClass: true,
          scheduleDays: true,
          ...(targetDate
            ? {
                scheduleExceptions: {
                  where: {
                    exceptionDate: this.normalizeDateOnly(targetDate),
                  },
                  take: 1,
                },
              }
            : {}),
        },
      }),
      counted ? this.prisma.classSchedule.count({ where }) : Promise.resolve(0),
    ]);

    // Map to entities
    const mappedDocs = docs.map(toClassScheduleEntity);
    const docsWithOptionalExceptions = docs.map((doc) =>
      this.withOptionalExceptions(doc),
    );

    // Enrich with per-date booking counts
    if (mappedDocs.length > 0) {
      if (targetDate) {
        // Explicit date: single batch query for all schedules
        const scheduleIds = mappedDocs.map((d) => d.id);
        const countMap = await this.getBookingCountsForDate(
          scheduleIds,
          targetDate,
        );
        for (const doc of mappedDocs) {
          doc.bookingsCount = countMap.get(doc.id) ?? 0;
        }

        mappedDocs.forEach((doc, index) => {
          this.applyOccurrence(
            doc,
            docsWithOptionalExceptions[index].scheduleExceptions ?? [],
            targetDate,
          );
        });
      } else {
        // No date: group by dayOfWeek, auto-resolve next occurrence per group
        // At most 7 queries (one per unique day), not N queries
        await this.enrichWithAutoResolvedCounts(mappedDocs);
      }
    }

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
   * Get schedules by day of week with optional booking counts
   */
  async getByDayOfWeek(
    dayOfWeek: DayOfWeek,
    targetDate?: Date,
  ): Promise<ClassScheduleEntity[]> {
    const schedules = await this.prisma.classSchedule.findMany({
      where: { dayOfWeek, isActive: true },
      include: { gymClass: true, scheduleDays: true },
      orderBy: { startTime: 'asc' },
    });

    const entities = schedules.map(toClassScheduleEntity);

    if (targetDate && entities.length > 0) {
      const ids = entities.map((e) => e.id);
      const countMap = await this.getBookingCountsForDate(ids, targetDate);
      for (const entity of entities) {
        entity.bookingsCount = countMap.get(entity.id) ?? 0;
      }
    }

    return entities;
  }

  /**
   * Get schedules by trainer with optional booking counts
   */
  async getByTrainerId(
    trainerId: string,
    targetDate?: Date,
  ): Promise<ClassScheduleEntity[]> {
    const schedules = await this.prisma.classSchedule.findMany({
      where: { trainerId },
      include: { gymClass: true, scheduleDays: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    const entities = schedules.map(toClassScheduleEntity);

    if (targetDate && entities.length > 0) {
      const ids = entities.map((e) => e.id);
      const countMap = await this.getBookingCountsForDate(ids, targetDate);
      for (const entity of entities) {
        entity.bookingsCount = countMap.get(entity.id) ?? 0;
      }
    }

    return entities;
  }

  /**
   * Count active bookings for a single schedule on a specific date
   */
  private async countBookingsForDate(
    scheduleId: string,
    targetDate: Date,
  ): Promise<number> {
    return this.prisma.classBooking.count({
      where: {
        classScheduleId: scheduleId,
        status: { in: ['pending', 'confirmed', 'attended'] },
        bookingStartDate: { lte: targetDate },
        bookingEndDate: { gte: targetDate },
      },
    });
  }

  /**
   * Batch count active bookings for multiple schedules on a specific date
   * Uses groupBy to avoid N+1 queries
   */
  private async getBookingCountsForDate(
    scheduleIds: string[],
    targetDate: Date,
  ): Promise<Map<string, number>> {
    const counts = await this.prisma.classBooking.groupBy({
      by: ['classScheduleId'],
      where: {
        classScheduleId: { in: scheduleIds },
        status: { in: ['pending', 'confirmed', 'attended'] },
        bookingStartDate: { lte: targetDate },
        bookingEndDate: { gte: targetDate },
      },
      _count: { id: true },
    });

    const map = new Map<string, number>();
    for (const row of counts) {
      if (row.classScheduleId) {
        map.set(row.classScheduleId, row._count.id);
      }
    }
    return map;
  }

  private applyOccurrence(
    entity: ClassScheduleEntity,
    scheduleExceptions: ScheduleException[],
    targetDate: Date,
  ): void {
    const exception = scheduleExceptions[0]
      ? toScheduleExceptionEntity(scheduleExceptions[0])
      : null;
    const currentBookings = entity.bookingsCount ?? 0;
    const occurrence: ClassScheduleOccurrenceEntity = {
      date: this.normalizeDateToUtcNoon(targetDate),
      status: 'scheduled',
      effectiveStartTime: entity.startTime,
      effectiveEndTime: entity.endTime,
      isBookable: true,
      currentBookings,
      remainingSlots: Math.max(0, entity.capacity - currentBookings),
      exception,
    };

    if (exception?.type === ExceptionType.CANCELLED) {
      occurrence.status = 'cancelled';
      occurrence.isBookable = false;
      occurrence.remainingSlots = 0;
    }

    if (exception?.type === ExceptionType.RESCHEDULED) {
      occurrence.status = 'rescheduled';
      occurrence.effectiveStartTime = exception.newStartTime ?? entity.startTime;
      occurrence.effectiveEndTime = exception.newEndTime ?? entity.endTime;
    }

    entity.occurrence = occurrence;
  }

  private normalizeDateOnly(date: Date): Date {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  private normalizeDateToUtcNoon(date: Date): Date {
    const normalized = new Date(date);
    normalized.setUTCHours(12, 0, 0, 0);
    return normalized;
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

  /**
   * Compute the next occurrence of a given day of week (UTC noon).
   * If today is that day, returns next week's occurrence.
   */
  private getNextOccurrence(dayOfWeek: DayOfWeek): Date {
    const dayMap: Record<string, number> = {
      SUN: 0,
      MON: 1,
      TUE: 2,
      WED: 3,
      THU: 4,
      FRI: 5,
      SAT: 6,
    };
    const target = dayMap[dayOfWeek] ?? 1;
    const today = new Date();
    const current = today.getUTCDay();
    const daysUntil = (target - current + 7) % 7 || 7;
    const next = new Date(today);
    next.setUTCDate(today.getUTCDate() + daysUntil);
    next.setUTCHours(12, 0, 0, 0);
    return next;
  }

  /**
   * Enrich schedules with booking counts by auto-resolving next occurrence.
   * Groups schedules by dayOfWeek → at most 7 batch queries.
   */
  private async enrichWithAutoResolvedCounts(
    schedules: ClassScheduleEntity[],
  ): Promise<void> {
    // Group schedules by dayOfWeek
    const byDay = new Map<DayOfWeek, ClassScheduleEntity[]>();
    for (const schedule of schedules) {
      if (!schedule.dayOfWeek) {
        schedule.bookingsCount = 0;
        continue;
      }
      const group = byDay.get(schedule.dayOfWeek) ?? [];
      group.push(schedule);
      byDay.set(schedule.dayOfWeek, group);
    }

    // For each unique day (max 7), compute next occurrence and batch count
    const promises = Array.from(byDay.entries()).map(
      async ([day, daySchedules]) => {
        const nextDate = this.getNextOccurrence(day);
        const ids = daySchedules.map((s) => s.id);
        const countMap = await this.getBookingCountsForDate(ids, nextDate);
        for (const schedule of daySchedules) {
          schedule.bookingsCount = countMap.get(schedule.id) ?? 0;
        }
      },
    );

    await Promise.all(promises);
  }
}
