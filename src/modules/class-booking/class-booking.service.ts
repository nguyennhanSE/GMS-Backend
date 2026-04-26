import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
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
import { ScheduleExceptionService } from '../class-schedule/schedule-exception.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { DayOfWeek, Prisma } from '@prisma/client';
import { BOOKING_STATUS } from './constants/booking-status.constants';
import { AppCacheService } from '../../libs/cache/cache.service';
import { buildClassScheduleInvalidationTags } from '../class-schedule/class-schedule.cache';
import { buildTrainerAvailabilityTag } from '../trainer/trainer.cache';

const BOOKING_SERIALIZABLE_RETRY_ATTEMPTS = 3;
const BOOKING_TRANSACTION_TIMEOUT_MS = 20000;

@Injectable()
export class ClassBookingService {
  private readonly logger = new Logger(ClassBookingService.name);

  constructor(
    private readonly classBookingRepository: ClassBookingRepository,
    private readonly classScheduleService: ClassScheduleService,
    private readonly scheduleExceptionService: ScheduleExceptionService,
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly appCacheService: AppCacheService,
  ) {}

  /**
   * Check if trainer is available for the given schedule
   * Now uses startTime/endTime instead of classStartTime/classEndTime
   */
  private async checkTrainerAvailability(
    trainerId: string,
    startTime: Date,
    endTime: Date,
    dayOfWeek: number,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const prismaClient = tx || this.prisma;
    const startHour = startTime.getHours();
    const startMinute = startTime.getMinutes();
    const endHour = endTime.getHours();
    const endMinute = endTime.getMinutes();

    // Get day of week from startTime (Time type stores as date, extract day)
    // For recurring schedules, we use the DayOfWeek enum value
    const trainerAvailabilities =
      await prismaClient.trainerAvailability.findMany({
        where: {
          trainerId: trainerId,
          dayOfWeek,
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

      const classStartMinutes = startHour * 60 + startMinute;
      const classEndMinutes = endHour * 60 + endMinute;
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
   * Convert DayOfWeek enum to JS day number for date calculations
   */
  private dayOfWeekToNumber(dayOfWeek: string): number {
    const mapping: Record<string, number> = {
      SUN: 0,
      MON: 1,
      TUE: 2,
      WED: 3,
      THU: 4,
      FRI: 5,
      SAT: 6,
    };
    return mapping[dayOfWeek] ?? 0;
  }

  /**
   * Convert JS day number to DayOfWeek enum string for error messages
   */
  private numberToDayOfWeek(dayNumber: number): DayOfWeek {
    const mapping: Record<number, DayOfWeek> = {
      0: DayOfWeek.SUN,
      1: DayOfWeek.MON,
      2: DayOfWeek.TUE,
      3: DayOfWeek.WED,
      4: DayOfWeek.THU,
      5: DayOfWeek.FRI,
      6: DayOfWeek.SAT,
    };
    const dayOfWeek = mapping[dayNumber];
    if (!dayOfWeek) {
      throw new BadRequestException(
        `Invalid booking day value: ${dayNumber}`,
      );
    }
    return dayOfWeek;
  }

  /**
   * Check if schedule is valid (within validFrom/validUntil range and isActive)
   */
  private isScheduleValid(schedule: {
    isActive: boolean;
    validFrom: Date | null;
    validUntil: Date | null;
  }): boolean {
    if (!schedule.isActive) {
      return false;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (schedule.validFrom && schedule.validFrom > today) {
      return false;
    }

    if (schedule.validUntil && schedule.validUntil < today) {
      return false;
    }

    return true;
  }

  private normalizeDateOnly(date: Date): Date {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  private async getScheduleExceptionForDate(
    scheduleId: string,
    date: Date,
    tx?: Prisma.TransactionClient,
  ) {
    if (!tx?.scheduleException) {
      return this.scheduleExceptionService.getExceptionForDate(scheduleId, date);
    }

    return tx.scheduleException.findUnique({
      where: {
        scheduleId_exceptionDate: {
          scheduleId,
          exceptionDate: this.normalizeDateOnly(date),
        },
      },
    });
  }

  /**
   * Create a new class booking with full race condition protection
   * Updated for new schema with GymClass relation
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

    const wantedSchedules = [...new Set(createClassBookingDto.classScheduleId)].sort();
    const userId = createClassBookingDto.userId;

    // Use Serializable isolation level to prevent race conditions.
    // Retrying P2034 conflicts prevents transient DB serialization failures
    // from leaking as 500s during concurrent booking attempts.
    const createdBookingIds = await this.runSerializableRetry(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const bookingIds: string[] = [];

            for (const scheduleId of wantedSchedules) {
              // ============================================
              // 1. LOCK THE SCHEDULE ROW (FOR UPDATE)
              // This prevents concurrent bookings from reading stale data.
              // Schedule ids are sorted before the transaction so concurrent
              // multi-schedule requests acquire locks in a deterministic order.
              // ============================================
              await tx.$queryRaw`
              SELECT id FROM class_schedules
              WHERE id = ${scheduleId}::uuid
              FOR UPDATE
            `;

              // Get the schedule with lock acquired, including gymClass relation
              const classSchedule = await tx.classSchedule.findUnique({
                where: { id: scheduleId },
                include: {
                  gymClass: true,
                  scheduleDays: {
                    select: {
                      dayOfWeek: true,
                    },
                  },
                },
              });

              if (!classSchedule) {
                throw new NotFoundException(
                  `Class schedule with id ${scheduleId} not found`,
                );
              }

              // Get class name from gymClass relation
              const className = classSchedule.gymClass.className;

              // ============================================
              // 2. SCHEDULE VALIDITY CHECK
              // Check if schedule is active and within valid date range
              // ============================================
              if (!this.isScheduleValid(classSchedule)) {
                throw new BadRequestException(
                  `Class "${className}" schedule is not currently active or valid`,
                );
              }

              // ============================================
              // 2.1. DAY OF WEEK VALIDATION
              // Booking date must match the schedule's recurring day
              // Uses UTC to avoid timezone issues
              // Supports both legacy dayOfWeek field and new scheduleDays relation
              // ============================================
              const bookingDate = new Date(createClassBookingDto.bookingStartDate!);
              const bookingDayOfWeek = bookingDate.getUTCDay(); // 0=Sun, 1=Mon, etc.

              // Get schedule days - prefer scheduleDays, fall back to legacy dayOfWeek
              const scheduleDaysOfWeek =
                classSchedule.scheduleDays?.length
                  ? classSchedule.scheduleDays.map(
                      (scheduleDay) => scheduleDay.dayOfWeek,
                    )
                  : classSchedule.dayOfWeek
                    ? [classSchedule.dayOfWeek]
                    : [];

              // Check if booking day matches any schedule day
              const bookingDayName = this.numberToDayOfWeek(bookingDayOfWeek);
              if (
                scheduleDaysOfWeek.length > 0 &&
                !scheduleDaysOfWeek.includes(bookingDayName)
              ) {
                const daysStr = scheduleDaysOfWeek.join(', ');
                throw new BadRequestException(
                  `Class "${className}" is scheduled for ${daysStr} only. ` +
                    `The booking date falls on ${bookingDayName}.`,
                );
              }

              // ============================================
              // 2.2. EXCEPTION DATE CHECK
              // Check if the booking date has a cancellation or rescheduling
              // ============================================
              const exception = await this.getScheduleExceptionForDate(
                scheduleId,
                bookingDate,
                tx,
              );

              if (exception) {
                if (exception.type === 'CANCELLED') {
                  const reason = exception.reason ? ` (${exception.reason})` : '';
                  throw new BadRequestException(
                    `Class "${className}" is cancelled on ${bookingDate.toISOString().split('T')[0]}${reason}`,
                  );
                } else if (exception.type === 'RESCHEDULED') {
                  const newTime = exception.newStartTime
                    ? ` to ${exception.newStartTime.toISOString().slice(11, 16)}-${exception.newEndTime?.toISOString().slice(11, 16)}`
                    : '';
                  throw new BadRequestException(
                    `Class "${className}" is rescheduled on ${bookingDate.toISOString().split('T')[0]}${newTime}. Please book for the new time slot.`,
                  );
                }
              }

              // ============================================
              // 3. SELF-BOOKING PREVENTION
              // Trainers cannot book their own classes
              // trainerId is now required (non-null)
              // ============================================
              if (classSchedule.trainerId === userId) {
                throw new BadRequestException(
                  `Trainers cannot book their own classes`,
                );
              }

              // ============================================
              // 4. DUPLICATE BOOKING CHECK
              // User cannot book the same class on overlapping dates
              // ============================================
              const existingBooking = await tx.classBooking.findFirst({
                where: {
                  userId: userId,
                  classScheduleId: scheduleId,
                  status: { notIn: ['cancelled'] },
                  // Date-aware: only check bookings that overlap with the requested date range
                  bookingStartDate: { lte: createClassBookingDto.bookingEndDate! },
                  bookingEndDate: { gte: createClassBookingDto.bookingStartDate! },
                },
              });

              if (existingBooking) {
                throw new BadRequestException(
                  `User already has an active booking for class "${className}"`,
                );
              }

              // ============================================
              // 5. CAPACITY CHECK (per-occurrence, not all-time)
              // Count only bookings that overlap with the requested date range
              // ============================================
              const currentBookingsCount = await tx.classBooking.count({
                where: {
                  classScheduleId: scheduleId,
                  status: { in: ['pending', 'confirmed', 'attended'] },
                  // Date-aware: only count bookings for this specific occurrence
                  bookingStartDate: { lte: createClassBookingDto.bookingEndDate! },
                  bookingEndDate: { gte: createClassBookingDto.bookingStartDate! },
                },
              });

              if (currentBookingsCount >= classSchedule.capacity) {
                throw new BadRequestException(
                  `Class "${className}" is full (${currentBookingsCount}/${classSchedule.capacity} spots taken)`,
                );
              }

              // ============================================
              // 6. TRAINER AVAILABILITY CHECK
              // trainerId is now required, use startTime/endTime
              // ============================================
              const isTrainerAvailable = await this.checkTrainerAvailability(
                classSchedule.trainerId,
                classSchedule.startTime,
                classSchedule.endTime,
                bookingDayOfWeek,
                tx,
              );

              if (!isTrainerAvailable) {
                throw new BadRequestException(
                  `Trainer is not available for class "${className}" at the scheduled time`,
                );
              }

              // ============================================
              // 7. CREATE OR REACTIVATE BOOKING
              // Uses upsert to handle cancel-and-rebook:
              // If a cancelled booking exists for the same (user, schedule, date),
              // reactivate it instead of inserting a duplicate row.
              // ============================================
              const newBooking = await tx.classBooking.upsert({
                where: {
                  unique_user_schedule_date_booking: {
                    userId: userId,
                    classScheduleId: scheduleId,
                    bookingStartDate: createClassBookingDto.bookingStartDate!,
                  },
                },
                update: {
                  status: 'pending',
                  bookingEndDate: createClassBookingDto.bookingEndDate!,
                },
                create: {
                  userId: userId,
                  classScheduleId: scheduleId,
                  bookingStartDate: createClassBookingDto.bookingStartDate!,
                  bookingEndDate: createClassBookingDto.bookingEndDate!,
                  status: 'pending',
                },
              });

              bookingIds.push(newBooking.id);
            }

            return bookingIds;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: BOOKING_TRANSACTION_TIMEOUT_MS,
          },
        ),
      'This class was just updated by another booking request. Please try again.',
    );

    const createdBookings = await this.prisma.classBooking.findMany({
      where: {
        id: {
          in: createdBookingIds,
        },
      },
      include: {
        user: true,
        classSchedule: {
          include: {
            gymClass: true,
          },
        },
      },
    });

    const bookingById = new Map(
      createdBookings.map((booking) => [booking.id, booking]),
    );

    const orderedCreatedBookings = createdBookingIds.map((bookingId) => {
      const booking = bookingById.get(bookingId);
      if (!booking) {
        throw new NotFoundException(
          `Class booking with id ${bookingId} not found after creation`,
        );
      }

      return booking as unknown as ClassBookingEntity;
    });

    await this.invalidateAvailabilityForScheduleIds(wantedSchedules);

    return orderedCreatedBookings;
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
    const updated = await this.classBookingRepository.update(
      id,
      updateClassBookingDto,
    );
    await this.invalidateAvailabilityForScheduleIds([
      existingBooking.classScheduleId,
    ]);

    return updated;
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

    const updated = await this.classBookingRepository.update(id, {
      status: 'cancelled',
    });
    await this.invalidateAvailabilityForScheduleIds([booking.classScheduleId]);

    return updated;
  }

  /**
   * Remove class booking (hard delete - admin only)
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if class booking exists
    const existing = await this.findOne(id);

    // Delete class booking
    await this.classBookingRepository.delete(id);
    await this.invalidateAvailabilityForScheduleIds([existing.classScheduleId]);

    return { message: `Class booking ${id} deleted successfully` };
  }

  // ============================================
  // SYSTEM-LEVEL METHODS (Payment Consumer)
  // No ownership/admin guards — called by RabbitMQ consumer
  // ============================================

  /**
   * Confirm a booking after successful payment.
   * Bypasses user-facing guards — system-triggered only.
   * @throws NotFoundException if booking does not exist
   */
  async confirmByPayment(bookingId: string): Promise<ClassBookingEntity> {
    const booking = await this.findOne(bookingId);

    if (booking.status === BOOKING_STATUS.CONFIRMED) {
      this.logger.log(`Booking ${bookingId} already confirmed — skipping`);
      return booking;
    }

    if (booking.status !== BOOKING_STATUS.PENDING) {
      this.logger.warn(
        `Booking ${bookingId} is '${booking.status}', cannot confirm`,
      );
      return booking;
    }

    const updated = await this.classBookingRepository.update(bookingId, {
      status: BOOKING_STATUS.CONFIRMED,
    });

    this.logger.log(`Booking ${bookingId} confirmed by payment`);
    return updated;
  }

  /**
   * Cancel a booking after payment failure or refund.
   * Bypasses user-facing guards — system-triggered only.
   * @throws NotFoundException if booking does not exist
   */
  async cancelByPayment(
    bookingId: string,
    reason: string,
  ): Promise<ClassBookingEntity | null> {
    const booking = await this.findOne(bookingId);

    if (booking.status === BOOKING_STATUS.CANCELLED) {
      this.logger.log(`Booking ${bookingId} already cancelled — skipping`);
      return null;
    }

    if (booking.status === BOOKING_STATUS.ATTENDED) {
      this.logger.warn(
        `Booking ${bookingId} is 'attended', cannot cancel by payment`,
      );
      return null;
    }

    const updated = await this.classBookingRepository.update(bookingId, {
      status: BOOKING_STATUS.CANCELLED,
    });
    await this.invalidateAvailabilityForScheduleIds([booking.classScheduleId]);

    this.logger.log(
      `Booking ${bookingId} cancelled by payment (reason: ${reason})`,
    );
    return updated;
  }

  /**
   * Initiate payment checkout for a booking.
   * Validates ownership and status, derives price server-side.
   */
  async initiateCheckout(
    bookingId: string,
    userId: string,
  ): Promise<{ checkoutUrl: string }> {
    const booking = await this.findOne(bookingId);

    if (booking.userId !== userId) {
      throw new ForbiddenException(
        "Cannot checkout for another user's booking",
      );
    }

    if (booking.status !== BOOKING_STATUS.PENDING) {
      throw new BadRequestException(
        `Booking is '${booking.status}', only pending bookings can be checked out`,
      );
    }

    // Derive price from schedule (server-side — never trust client)
    const schedule = await this.prisma.classSchedule.findUnique({
      where: { id: booking.classScheduleId },
      select: { price: true },
    });

    if (!schedule || schedule.price <= 0) {
      throw new BadRequestException(
        'This class has no price configured. Contact admin.',
      );
    }

    const result = await this.paymentService.createCheckout(userId, {
      targetType: 'CLASS_BOOKING' as any,
      targetId: bookingId,
      amount: schedule.price,
      currency: 'VND',
    });

    if (!result.checkoutUrl) {
      throw new BadRequestException(
        'Checkout session could not be created. Please try again.',
      );
    }

    return { checkoutUrl: result.checkoutUrl };
  }

  private async invalidateAvailabilityForScheduleIds(
    scheduleIds: string[],
  ): Promise<void> {
    const uniqueScheduleIds = [...new Set(scheduleIds.filter(Boolean))];
    if (uniqueScheduleIds.length === 0) {
      return;
    }

    const schedules = await this.prisma.classSchedule.findMany({
      where: {
        id: {
          in: uniqueScheduleIds,
        },
      },
      select: {
        id: true,
        trainerId: true,
      },
    });

    const tags = new Set<string>();

    for (const schedule of schedules) {
      for (const tag of buildClassScheduleInvalidationTags({
        scheduleId: schedule.id,
        trainerIds: [schedule.trainerId],
      })) {
        tags.add(tag);
      }

      tags.add(buildTrainerAvailabilityTag(schedule.trainerId));
    }

    await this.appCacheService.invalidateTags([...tags]);
  }

  private async runSerializableRetry<T>(
    operation: () => Promise<T>,
    finalMessage: string,
    maxAttempts: number = BOOKING_SERIALIZABLE_RETRY_ATTEMPTS,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.isSerializableConflict(error) || attempt === maxAttempts - 1) {
          break;
        }
      }
    }

    if (this.isSerializableConflict(lastError)) {
      throw new BadRequestException(finalMessage);
    }

    throw lastError;
  }

  private isSerializableConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2034';
    }

    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2034'
    );
  }
}
