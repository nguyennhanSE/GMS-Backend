import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ClassBookingEntity } from './entities/class-booking.entity';
import {
  CreateClassBookingDto,
  CreateMultipleClassBookingDto,
} from './dto/create-class-booking.dto';
import { UpdateClassBookingDto } from './dto/update-class-booking.dto';
import {
  ClassBookingRepository,
  ClassBookingFilterDto,
} from './repositories/class-booking.repository';
import {
  IPaginate,
  PaginateOptions,
} from '../../libs/models/paginate/pagimate.model';
import { ClassScheduleService } from '../class-schedule/class-schedule.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ClassBookingService {
  constructor(
    private readonly classBookingRepository: ClassBookingRepository,
    private readonly classScheduleService: ClassScheduleService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Check if trainer is available for the given schedule
   */
  private async checkTrainerAvailability(
    trainerId: string,
    classStartTime: Date,
    classEndTime: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const prismaClient = tx || this.prisma;
    const dayOfWeek = classStartTime.getDay();

    const classStartHour = classStartTime.getHours();
    const classStartMinute = classStartTime.getMinutes();
    const classEndHour = classEndTime.getHours();
    const classEndMinute = classEndTime.getMinutes();

    const trainerAvailabilities =
      await prismaClient.trainerAvailability.findMany({
        where: {
          trainerId: trainerId,
          dayOfWeek: dayOfWeek,
          isAvailable: true,
        },
      });

    if (trainerAvailabilities.length === 0) {
      return false;
    }

    for (const availability of trainerAvailabilities) {
      const availStartTime = availability.startTime;
      const availEndTime = availability.endTime;

      const availStartHour = availStartTime.getHours();
      const availStartMinute = availStartTime.getMinutes();
      const availEndHour = availEndTime.getHours();
      const availEndMinute = availEndTime.getMinutes();

      const classStartMinutes = classStartHour * 60 + classStartMinute;
      const classEndMinutes = classEndHour * 60 + classEndMinute;
      const availStartMinutes = availStartHour * 60 + availStartMinute;
      const availEndMinutes = availEndHour * 60 + availEndMinute;

      if (
        classStartMinutes >= availStartMinutes &&
        classEndMinutes <= availEndMinutes
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create a new class booking with full race condition protection
   */
  async create(
    createClassBookingDto: CreateMultipleClassBookingDto,
  ): Promise<ClassBookingEntity[]> {
    // Validate dates
    if (
      createClassBookingDto?.bookingStartDate &&
      createClassBookingDto?.bookingEndDate &&
      createClassBookingDto.bookingStartDate >=
        createClassBookingDto.bookingEndDate
    ) {
      throw new BadRequestException(
        'Booking start date must be before end date',
      );
    }

    const wantedSchedules = createClassBookingDto.classScheduleId;
    const userId = createClassBookingDto.userId;

    // Use Serializable isolation level to prevent race conditions
    const createdBookings = await this.prisma.$transaction(
      async (tx) => {
        const bookingsToCreate: ClassBookingEntity[] = [];

        for (const scheduleId of wantedSchedules) {
          // ============================================
          // 1. LOCK THE SCHEDULE ROW (FOR UPDATE)
          // This prevents concurrent bookings from reading stale data
          // ============================================
          await tx.$queryRaw`
          SELECT id FROM class_schedules 
          WHERE id = ${scheduleId}::uuid 
          FOR UPDATE
        `;

          // Get the schedule with lock acquired
          const classSchedule = await tx.classSchedule.findUnique({
            where: { id: scheduleId },
          });

          if (!classSchedule) {
            throw new NotFoundException(
              `Class schedule with id ${scheduleId} not found`,
            );
          }

          // ============================================
          // 2. PAST DATE PROTECTION
          // Cannot book classes that have already started
          // ============================================
          if (classSchedule.classStartTime < new Date()) {
            throw new BadRequestException(
              `Cannot book class "${classSchedule.name}" - it has already started or passed`,
            );
          }

          // ============================================
          // 3. SELF-BOOKING PREVENTION
          // Trainers cannot book their own classes
          // ============================================
          if (classSchedule.trainerId && classSchedule.trainerId === userId) {
            throw new BadRequestException(
              `Trainers cannot book their own classes`,
            );
          }

          // ============================================
          // 4. DUPLICATE BOOKING CHECK
          // User cannot book the same class multiple times
          // ============================================
          const existingBooking = await tx.classBooking.findFirst({
            where: {
              userId: userId,
              classScheduleId: scheduleId,
              status: { notIn: ['cancelled'] },
            },
          });

          if (existingBooking) {
            throw new BadRequestException(
              `User already has an active booking for class "${classSchedule.name}"`,
            );
          }

          // ============================================
          // 5. CAPACITY CHECK
          // Ensure we don't exceed maxCapacity
          // ============================================
          const currentBookingsCount = await tx.classBooking.count({
            where: {
              classScheduleId: scheduleId,
              status: { in: ['pending', 'confirmed', 'attended'] },
            },
          });

          if (currentBookingsCount >= classSchedule.maxCapacity) {
            throw new BadRequestException(
              `Class "${classSchedule.name}" is full (${currentBookingsCount}/${classSchedule.maxCapacity} spots taken)`,
            );
          }

          // ============================================
          // 6. TRAINER AVAILABILITY CHECK
          // ============================================
          if (classSchedule.trainerId) {
            const isTrainerAvailable = await this.checkTrainerAvailability(
              classSchedule.trainerId,
              classSchedule.classStartTime,
              classSchedule.classEndTime,
              tx,
            );

            if (!isTrainerAvailable) {
              throw new BadRequestException(
                `Trainer is not available for class "${classSchedule.name}" at the scheduled time`,
              );
            }
          }

          // ============================================
          // 7. CREATE BOOKING WITH FORCED PENDING STATUS
          // ============================================
          const newBooking = await tx.classBooking.create({
            data: {
              userId: userId,
              classScheduleId: scheduleId,
              bookingStartDate: createClassBookingDto.bookingStartDate!,
              bookingEndDate: createClassBookingDto.bookingEndDate!,
              status: 'pending', // Always start as pending
            },
            include: {
              user: true,
              classSchedule: true,
            },
          });

          bookingsToCreate.push(newBooking as unknown as ClassBookingEntity);
        }

        return bookingsToCreate;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000, // 10 second timeout
      },
    );

    return createdBookings;
  }

  /**
   * Get paginated class bookings
   */
  async findAll(
    paginateRequest: PaginateOptions,
    filter: ClassBookingFilterDto,
    options: { counted?: boolean },
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
  async findByClassScheduleId(
    classScheduleId: string,
  ): Promise<ClassBookingEntity[]> {
    return this.classBookingRepository.getByClassScheduleId(classScheduleId);
  }

  /**
   * Update class booking (only status can be changed)
   */
  async update(
    id: string,
    updateClassBookingDto: UpdateClassBookingDto,
  ): Promise<ClassBookingEntity> {
    // Check if class booking exists
    const existingBooking = await this.findOne(id);

    // Only status updates are allowed (DTO enforces this)
    return this.classBookingRepository.update(id, updateClassBookingDto);
  }

  /**
   * Cancel a class booking (soft delete by setting status to cancelled)
   * Members can cancel their own bookings, admins can cancel any booking
   */
  async cancel(
    id: string,
    currentUserId: string,
    isAdmin: boolean,
  ): Promise<ClassBookingEntity> {
    const booking = await this.findOne(id);

    // Ownership check: non-admins can only cancel their own bookings
    if (!isAdmin && booking.userId !== currentUserId) {
      throw new ForbiddenException('You can only cancel your own bookings');
    }

    // Cannot cancel already cancelled bookings
    if (booking.status === 'cancelled') {
      throw new BadRequestException('This booking is already cancelled');
    }

    // Cannot cancel attended bookings
    if (booking.status === 'attended') {
      throw new BadRequestException('Cannot cancel an attended booking');
    }

    return this.classBookingRepository.update(id, { status: 'cancelled' });
  }

  /**
   * Remove class booking (hard delete - admin only)
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if class booking exists
    await this.findOne(id);

    // Delete class booking
    await this.classBookingRepository.delete(id);

    return { message: `Class booking ${id} deleted successfully` };
  }
}
