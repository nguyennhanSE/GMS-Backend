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
   * Check if trainer is available for the given schedule
   */
  private async checkTrainerAvailability(
    trainerId: string,
    classStartTime: Date,
    classEndTime: Date
  ): Promise<boolean> {
    const dayOfWeek = classStartTime.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    
    // Extract time components from the class schedule
    const classStartHour = classStartTime.getHours();
    const classStartMinute = classStartTime.getMinutes();
    const classEndHour = classEndTime.getHours();
    const classEndMinute = classEndTime.getMinutes();

    // Query trainer availability for that day of week
    const trainerAvailabilities = await this.prisma.trainerAvailability.findMany({
      where: {
        trainerId: trainerId,
        dayOfWeek: dayOfWeek,
        isAvailable: true,
      },
    });

    if (trainerAvailabilities.length === 0) {
      return false; // Trainer not available on this day
    }

    // Check if class time falls within any of the trainer's availability windows
    for (const availability of trainerAvailabilities) {
      const availStartTime = availability.startTime;
      const availEndTime = availability.endTime;

      const availStartHour = availStartTime.getHours();
      const availStartMinute = availStartTime.getMinutes();
      const availEndHour = availEndTime.getHours();
      const availEndMinute = availEndTime.getMinutes();

      // Convert to minutes for easier comparison
      const classStartMinutes = classStartHour * 60 + classStartMinute;
      const classEndMinutes = classEndHour * 60 + classEndMinute;
      const availStartMinutes = availStartHour * 60 + availStartMinute;
      const availEndMinutes = availEndHour * 60 + availEndMinute;

      // Check if class time is within availability window
      if (classStartMinutes >= availStartMinutes && classEndMinutes <= availEndMinutes) {
        return true;
      }
    }

    return false; // Class time doesn't fall within any availability window
  }

  /**
   * Check if there are conflicting bookings for the schedule or trainer
   */
  private async checkScheduleConflicts(
    scheduleId: string,
    trainerId: string | null,
    bookingStartDate: Date,
    bookingEndDate: Date,
    classStartTime: Date,
    classEndTime: Date
  ): Promise<void> {
    // Check for overlapping bookings on the same schedule
    const overlappingBookings = await this.prisma.classBooking.findMany({
      where: {
        classScheduleId: scheduleId,
        status: { not: 'cancelled' },
        OR: [
          {
            AND: [
              { bookingStartDate: { lte: bookingStartDate } },
              { bookingEndDate: { gte: bookingStartDate } },
            ],
          },
          {
            AND: [
              { bookingStartDate: { lte: bookingEndDate } },
              { bookingEndDate: { gte: bookingEndDate } },
            ],
          },
          {
            AND: [
              { bookingStartDate: { gte: bookingStartDate } },
              { bookingEndDate: { lte: bookingEndDate } },
            ],
          },
        ],
      },
    });

    if (overlappingBookings.length > 0) {
      throw new BadRequestException(
        `Schedule conflict: This class schedule already has bookings during the requested period`
      );
    }

    // If trainer is assigned, check for trainer conflicts across all schedules
    if (trainerId) {
      const trainerConflicts = await this.prisma.classBooking.findMany({
        where: {
          classSchedule: {
            trainerId: trainerId,
          },
          status: { not: 'cancelled' },
          OR: [
            {
              AND: [
                { bookingStartDate: { lte: bookingStartDate } },
                { bookingEndDate: { gte: bookingStartDate } },
              ],
            },
            {
              AND: [
                { bookingStartDate: { lte: bookingEndDate } },
                { bookingEndDate: { gte: bookingEndDate } },
              ],
            },
            {
              AND: [
                { bookingStartDate: { gte: bookingStartDate } },
                { bookingEndDate: { lte: bookingEndDate } },
              ],
            },
          ],
        },
        include: {
          classSchedule: true,
        },
      });

      // Check if any of the conflicts overlap in time
      for (const conflict of trainerConflicts) {
        if (conflict.classSchedule) {
          const conflictStart = conflict.classSchedule.classStartTime;
          const conflictEnd = conflict.classSchedule.classEndTime;

          // Check if times overlap (even on different dates)
          const classStartMinutes = classStartTime.getHours() * 60 + classStartTime.getMinutes();
          const classEndMinutes = classEndTime.getHours() * 60 + classEndTime.getMinutes();
          const conflictStartMinutes = conflictStart.getHours() * 60 + conflictStart.getMinutes();
          const conflictEndMinutes = conflictEnd.getHours() * 60 + conflictEnd.getMinutes();

          // Check for time overlap
          if (
            (classStartMinutes < conflictEndMinutes && classEndMinutes > conflictStartMinutes)
          ) {
            throw new BadRequestException(
              `Trainer conflict: This trainer is already assigned to another class during this time period`
            );
          }
        }
      }
    }
  }

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
      // Validate all schedules exist and check availability
      const schedulesData = await Promise.all(wantedSchedules.map(async (scheduleId) => {
        const classSchedule = await this.classScheduleService.findOne(scheduleId);
        if (!classSchedule) {
          throw new NotFoundException(`Class schedule with id ${scheduleId} not found`);
        }

        // Validate that class times are set
        if (!classSchedule.classStartTime || !classSchedule.classEndTime) {
          throw new BadRequestException(`Class schedule ${scheduleId} does not have start/end times set`);
        }

        // Check trainer availability if trainer is assigned
        if (classSchedule.trainerId) {
          const isTrainerAvailable = await this.checkTrainerAvailability(
            classSchedule.trainerId,
            classSchedule.classStartTime,
            classSchedule.classEndTime
          );

          if (!isTrainerAvailable) {
            throw new BadRequestException(
              `Trainer is not available for class schedule "${classSchedule.name}" at the scheduled time`
            );
          }
        }

        // Check for scheduling conflicts (both schedule and trainer conflicts)
        await this.checkScheduleConflicts(
          scheduleId,
          classSchedule.trainerId || null,
          createClassBookingDto.bookingStartDate!,
          createClassBookingDto.bookingEndDate!,
          classSchedule.classStartTime,
          classSchedule.classEndTime
        );

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
    const existingBooking = await this.findOne(id);

    // Validate dates if both are provided
    if (updateClassBookingDto.bookingStartDate && updateClassBookingDto.bookingEndDate) {
      if (updateClassBookingDto.bookingStartDate >= updateClassBookingDto.bookingEndDate) {
        throw new BadRequestException('Booking start date must be before end date');
      }
    }

    // If schedule is being changed or dates are being changed, check availability
    if (updateClassBookingDto.classScheduleId || updateClassBookingDto.bookingStartDate || updateClassBookingDto.bookingEndDate) {
      const scheduleId = updateClassBookingDto.classScheduleId || existingBooking.classScheduleId;
      const startDate = updateClassBookingDto.bookingStartDate || existingBooking.bookingStartDate;
      const endDate = updateClassBookingDto.bookingEndDate || existingBooking.bookingEndDate;

      if (!scheduleId) {
        throw new BadRequestException('Class schedule ID is required');
      }

      const classSchedule = await this.classScheduleService.findOne(scheduleId);
      
      if (!classSchedule.classStartTime || !classSchedule.classEndTime) {
        throw new BadRequestException(`Class schedule ${scheduleId} does not have start/end times set`);
      }

      // Check trainer availability if trainer is assigned
      if (classSchedule.trainerId) {
        const isTrainerAvailable = await this.checkTrainerAvailability(
          classSchedule.trainerId,
          classSchedule.classStartTime,
          classSchedule.classEndTime
        );

        if (!isTrainerAvailable) {
          throw new BadRequestException(
            `Trainer is not available for class schedule "${classSchedule.name}" at the scheduled time`
          );
        }
      }

      // Check for conflicts (excluding the current booking)
      const overlappingBookings = await this.prisma.classBooking.findMany({
        where: {
          id: { not: id },
          classScheduleId: scheduleId,
          status: { not: 'cancelled' },
          OR: [
            {
              AND: [
                { bookingStartDate: { lte: startDate } },
                { bookingEndDate: { gte: startDate } },
              ],
            },
            {
              AND: [
                { bookingStartDate: { lte: endDate } },
                { bookingEndDate: { gte: endDate } },
              ],
            },
            {
              AND: [
                { bookingStartDate: { gte: startDate } },
                { bookingEndDate: { lte: endDate } },
              ],
            },
          ],
        },
      });

      if (overlappingBookings.length > 0) {
        throw new BadRequestException(
          `Schedule conflict: This class schedule already has bookings during the requested period`
        );
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
