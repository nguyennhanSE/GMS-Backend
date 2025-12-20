import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { ClassScheduleEntity } from "../entities/class-schedule.entity";
import { CreateClassScheduleDto } from "../dto/create-class-schedule.dto";
import { UpdateClassScheduleDto } from "../dto/update-class-schedule.dto";
import { toClassScheduleEntity, toPrismaClassScheduleCreateInput } from "../mapper/class-schedule.mapper";
import { IPaginate, PaginateOptions } from "../../../libs/models/paginate/pagimate.model";
import { Prisma } from "@prisma/client";

export interface ClassScheduleFilterDto {
  q?: string;
  searchField?: string;
}

@Injectable()
export class ClassScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get class schedule by ID
   */
  async getById(id: string): Promise<ClassScheduleEntity | null> {
    if (!id || id.trim() === '') {
      return null;
    }

    try {
      const classSchedule = await this.prisma.classSchedule.findUnique({
        where: { id: id.trim() },
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
   * Get class schedule by name
   */
  async getByName(name: string): Promise<ClassScheduleEntity | null> {
    const classSchedule = await this.prisma.classSchedule.findUnique({
      where: { name },
    });
    
    if (!classSchedule) {
      return null;
    }
    
    return toClassScheduleEntity(classSchedule);
  }

  /**
   * Create a new class schedule
   */
  async create(createDto: CreateClassScheduleDto): Promise<ClassScheduleEntity> {
    const createdClassSchedule = await this.prisma.classSchedule.create({
      data: toPrismaClassScheduleCreateInput(createDto),
    });

    return toClassScheduleEntity(createdClassSchedule);
  }

  /**
   * Update class schedule
   */
  async update(id: string, updateDto: UpdateClassScheduleDto): Promise<ClassScheduleEntity> {
    // Check if class schedule exists
    const existing = await this.prisma.classSchedule.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new BadRequestException(`ClassSchedule with id ${id} not found`);
    }

    // Prepare update data
    const updateData: Prisma.ClassScheduleUpdateInput = {};
    
    if (updateDto.name !== undefined) {
      updateData.name = updateDto.name;
    }
    
    if (updateDto.description !== undefined) {
      updateData.description = updateDto.description || null;
    }

    // Update class schedule
    const updatedClassSchedule = await this.prisma.classSchedule.update({
      where: { id },
      data: updateData,
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
    options: PaginateOptions
  ): Promise<IPaginate<ClassScheduleEntity>> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const sort = options.sort || 'asc';
    const sortBy = options.sortBy || 'createdAt';
    const counted = options.counted ?? true;

    const { q: search, searchField } = filter;

    // Build where clause
    const where: Prisma.ClassScheduleWhereInput = {};

    if (search) {
      if (searchField) {
        // Search in specific field
        if (searchField === 'name') {
          where.name = { contains: search, mode: 'insensitive' };
        } else if (searchField === 'description') {
          where.description = { contains: search, mode: 'insensitive' };
        }
      } else {
        // Search in name and description by default
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }
    }

    // Build orderBy
    const allowedSortFields = ['id', 'name', 'createdAt', 'updatedAt'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    
    let orderBy: Prisma.ClassScheduleOrderByWithRelationInput;
    if (sortField === 'id') {
      orderBy = { id: sort };
    } else if (sortField === 'name') {
      orderBy = { name: sort };
    } else if (sortField === 'createdAt') {
      orderBy = { createdAt: sort };
    } else if (sortField === 'updatedAt') {
      orderBy = { updatedAt: sort };
    } else {
      orderBy = { createdAt: sort };
    }

    // Calculate skip
    const skip = (page - 1) * limit;

    // Execute queries
    const [docs, totalDocs] = await Promise.all([
      this.prisma.classSchedule.findMany({
        where,
        orderBy,
        skip,
        take: limit,
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
}

