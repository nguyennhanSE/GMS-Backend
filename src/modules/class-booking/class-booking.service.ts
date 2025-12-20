import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ClassBookingEntity } from './entities/class-booking.entity';
import { CreateClassBookingDto, CreateMultipleClassBookingDto } from './dto/create-class-booking.dto';
import { UpdateClassBookingDto } from './dto/update-class-booking.dto';
import { ClassBookingRepository, ClassBookingFilterDto } from './repositories/class-booking.repository';
import { IPaginate, PaginateOptions } from '../../libs/models/paginate/pagimate.model';
import { ClassScheduleService } from '../class-schedule/class-schedule.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ClassBookingService {
  constructor(
    private readonly classBookingRepository: ClassBookingRepository,  
    private readonly classScheduleService: ClassScheduleService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Create a new class booking
   */
  async create(createClassBookingDto: CreateMultipleClassBookingDto): Promise<ClassBookingEntity[]> {
    // Validate dates
    if (createClassBookingDto?.bookingStartDate && createClassBookingDto?.bookingEndDate && createClassBookingDto.bookingStartDate >= createClassBookingDto.bookingEndDate) {
      throw new BadRequestException('Booking start date must be before end date');
    }
    
    const wantedSchedules = createClassBookingDto.classScheduleId;
    const createdBookings = await this.prisma.$transaction(async (tx) => {
      // Validate all schedules exist
      await Promise.all(wantedSchedules.map(async (schedule) => {
        const classSchedule = await this.classScheduleService.findOne(schedule);
        if (!classSchedule) {
          throw new NotFoundException(`Class schedule with id ${schedule} not found`);
        }
        return classSchedule;
      }));
      
      // Create the bookings
      const bookings = await Promise.all(wantedSchedules.map(async (schedule) => {
        return await this.classBookingRepository.create({
          ...createClassBookingDto,
          classScheduleId: schedule,
        });
      }));
      
      return bookings;
    });
    
    return createdBookings;
  }

  /**
   * Get paginated class bookings
   */
  async findAll(
    paginateRequest: PaginateOptions,
    filter: ClassBookingFilterDto,
    options: { counted?: boolean }
  ): Promise<IPaginate<ClassBookingEntity>> {
    return this.classBookingRepository.getPaginate(filter, {
      ...paginateRequest,
      counted: options.counted,
    });
  }

  /**
   * Find one class booking by id
   */
  async findOne(id: string): Promise<ClassBookingEntity> {
    const classBooking = await this.classBookingRepository.getById(id, true);
    if (!classBooking) {
      throw new NotFoundException(`Class booking with id ${id} not found`);
    }
    return classBooking;
  }

  /**
   * Get bookings by user ID
   */
  async findByUserId(userId: string): Promise<ClassBookingEntity[]> {
    return this.classBookingRepository.getByUserId(userId);
  }

  /**
   * Get bookings by class schedule ID
   */
  async findByClassScheduleId(classScheduleId: string): Promise<ClassBookingEntity[]> {
    return this.classBookingRepository.getByClassScheduleId(classScheduleId);
  }

  /**
   * Update class booking
   */
  async update(id: string, updateClassBookingDto: UpdateClassBookingDto): Promise<ClassBookingEntity> {
    // Check if class booking exists
    await this.findOne(id);

    // Validate dates if both are provided
    if (updateClassBookingDto.bookingStartDate && updateClassBookingDto.bookingEndDate) {
      if (updateClassBookingDto.bookingStartDate >= updateClassBookingDto.bookingEndDate) {
        throw new BadRequestException('Booking start date must be before end date');
      }
    }

    return this.classBookingRepository.update(id, updateClassBookingDto);
  }

  /**
   * Remove class booking
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if class booking exists
    await this.findOne(id);

    // Delete class booking
    await this.classBookingRepository.delete(id);

    return { message: `Class booking ${id} deleted successfully` };
  }
}
