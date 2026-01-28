import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { ClassBookingEntity } from '../entities/class-booking.entity';
import { CreateClassBookingDto } from '../dto/create-class-booking.dto';
import { UpdateClassBookingDto } from '../dto/update-class-booking.dto';
import {
  toClassBookingEntity,
  toClassBookingEntityWithRelations,
  toPrismaClassBookingCreateInput,
} from '../mapper/class-booking.mapper';
import {
  IPaginate,
  PaginateOptions,
} from '../../../libs/models/paginate/pagimate.model';
import { Prisma } from '@prisma/client';

export interface ClassBookingFilterDto {
  userId?: string;
  classScheduleId?: string;
  status?: string;
  q?: string;
  searchField?: string;
}

@Injectable()
export class ClassBookingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get class booking by ID
   */
  async getById(
    id: string,
    includeRelations = false,
  ): Promise<ClassBookingEntity | null> {
    if (!id || id.trim() === '') {
      return null;
    }

    try {
      if (includeRelations) {
        const classBooking = await this.prisma.classBooking.findUnique({
          where: { id: id.trim() },
          include: {
            user: true,
            classSchedule: { include: { gymClass: true, scheduleDays: true } },
          },
        });

        if (!classBooking) {
          return null;
        }

        return toClassBookingEntityWithRelations(classBooking);
      } else {
        const classBooking = await this.prisma.classBooking.findUnique({
          where: { id: id.trim() },
        });

        if (!classBooking) {
          return null;
        }

        return toClassBookingEntity(classBooking);
      }
    } catch (error) {
      console.error('Prisma error in getById:', error);
      throw error;
    }
  }

  /**
   * Get class bookings by user ID
   */
  async getByUserId(userId: string): Promise<ClassBookingEntity[]> {
    const classBookings = await this.prisma.classBooking.findMany({
      where: { userId },
      include: {
        user: true,
        classSchedule: { include: { gymClass: true, scheduleDays: true } },
      },
    });

    return classBookings.map(toClassBookingEntityWithRelations);
  }

  /**
   * Get class bookings by class schedule ID
   */
  async getByClassScheduleId(
    classScheduleId: string,
  ): Promise<ClassBookingEntity[]> {
    const classBookings = await this.prisma.classBooking.findMany({
      where: { classScheduleId },
      include: {
        user: true,
        classSchedule: { include: { gymClass: true, scheduleDays: true } },
      },
    });

    return classBookings.map(toClassBookingEntityWithRelations);
  }

  /**
   * Create a new class booking
   */
  async create(createDto: CreateClassBookingDto): Promise<ClassBookingEntity> {
    const createdClassBooking = await this.prisma.classBooking.create({
      data: toPrismaClassBookingCreateInput(createDto),
      include: {
        user: true,
        classSchedule: { include: { gymClass: true, scheduleDays: true } },
      },
    });

    return toClassBookingEntityWithRelations(createdClassBooking);
  }

  /**
   * Update class booking (only status can be changed)
   */
  async update(
    id: string,
    updateDto: UpdateClassBookingDto,
  ): Promise<ClassBookingEntity> {
    // Check if class booking exists
    const existing = await this.prisma.classBooking.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new BadRequestException(`ClassBooking with id ${id} not found`);
    }

    // Only status updates are allowed
    const updateData: Prisma.ClassBookingUpdateInput = {};

    if (updateDto.status !== undefined) {
      updateData.status = updateDto.status;
    }

    // Update class booking
    const updatedClassBooking = await this.prisma.classBooking.update({
      where: { id },
      data: updateData,
      include: {
        user: true,
        classSchedule: { include: { gymClass: true, scheduleDays: true } },
      },
    });

    return toClassBookingEntityWithRelations(updatedClassBooking);
  }

  /**
   * Delete class booking
   */
  async delete(id: string): Promise<void> {
    // Check if class booking exists
    const existing = await this.prisma.classBooking.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new BadRequestException(`ClassBooking with id ${id} not found`);
    }

    // Delete class booking
    await this.prisma.classBooking.delete({
      where: { id },
    });
  }

  /**
   * Get paginated class bookings
   */
  async getPaginate(
    filter: ClassBookingFilterDto,
    options: PaginateOptions,
  ): Promise<IPaginate<ClassBookingEntity>> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const sort = options.sort || 'desc';
    const sortBy = options.sortBy || 'createdAt';
    const counted = options.counted ?? true;

    const { userId, classScheduleId, status, q: search, searchField } = filter;

    // Build where clause
    const where: Prisma.ClassBookingWhereInput = {};

    if (userId) {
      where.userId = userId;
    }

    if (classScheduleId) {
      where.classScheduleId = classScheduleId;
    }

    if (status) {
      where.status = status;
    }

    if (search) {
      if (searchField) {
        // Search in specific field
        if (searchField === 'status') {
          where.status = { contains: search, mode: 'insensitive' };
        }
      } else {
        // Search in status by default or filter by user/classSchedule name
        where.OR = [
          { status: { contains: search, mode: 'insensitive' } },
          {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
          {
            classSchedule: {
              gymClass: {
                className: { contains: search, mode: 'insensitive' },
              },
            },
          },
        ];
      }
    }

    // Build orderBy
    const allowedSortFields = [
      'id',
      'bookingStartDate',
      'bookingEndDate',
      'createdAt',
      'status',
    ];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    let orderBy: Prisma.ClassBookingOrderByWithRelationInput;
    if (sortField === 'id') {
      orderBy = { id: sort };
    } else if (sortField === 'bookingStartDate') {
      orderBy = { bookingStartDate: sort };
    } else if (sortField === 'bookingEndDate') {
      orderBy = { bookingEndDate: sort };
    } else if (sortField === 'createdAt') {
      orderBy = { createdAt: sort };
    } else if (sortField === 'status') {
      orderBy = { status: sort };
    } else {
      orderBy = { createdAt: sort };
    }

    // Calculate skip
    const skip = (page - 1) * limit;

    // Execute queries with relations
    const [docs, totalDocs] = await Promise.all([
      this.prisma.classBooking.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          user: true,
          classSchedule: { include: { gymClass: true, scheduleDays: true } },
        },
      }),
      counted ? this.prisma.classBooking.count({ where }) : Promise.resolve(0),
    ]);

    // Map to entities with relations
    const mappedDocs = docs.map(toClassBookingEntityWithRelations);

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
}
