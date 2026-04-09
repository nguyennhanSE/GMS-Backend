import { ClassBookingEntity } from 'src/modules/class-booking/entities/class-booking.entity';
import { GymClassEntity } from './gym-class.entity';
import { ScheduleExceptionEntity } from './schedule-exception.entity';

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

// ScheduleDay entity for multi-day schedules
export class ScheduleDayEntity {
  id!: string;
  scheduleId!: string;
  dayOfWeek!: DayOfWeek;
  createdAt?: Date | null;
}

export type ClassScheduleOccurrenceStatus =
  | 'scheduled'
  | 'cancelled'
  | 'rescheduled';

export class ClassScheduleOccurrenceEntity {
  date!: Date;
  status!: ClassScheduleOccurrenceStatus;
  effectiveStartTime!: Date;
  effectiveEndTime!: Date;
  isBookable!: boolean;
  currentBookings!: number;
  remainingSlots!: number;
  exception?: ScheduleExceptionEntity | null;
}

export class ClassScheduleEntity {
  id!: string;
  classId!: string;
  trainerId!: string;

  // Recurring schedule pattern - dayOfWeek is now optional (legacy support)
  // Use scheduleDays for multi-day schedules
  dayOfWeek?: DayOfWeek | null;
  startTime!: Date;
  endTime!: Date;

  // Validity period
  validFrom?: Date | null;
  validUntil?: Date | null;

  // Capacity and location
  location?: string | null;
  capacity!: number;
  isActive!: boolean;

  createdAt?: Date | null;
  updatedAt?: Date | null;

  // Computed: active bookings count for a specific date
  bookingsCount?: number;

  // Relations
  gymClass?: GymClassEntity | null;
  classBookings?: ClassBookingEntity[];
  scheduleDays?: ScheduleDayEntity[];
  occurrence?: ClassScheduleOccurrenceEntity | null;
  trainer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

// Helper function to get all days a schedule runs on
export function getDaysOfWeek(entity: ClassScheduleEntity): DayOfWeek[] {
  if (entity.scheduleDays && entity.scheduleDays.length > 0) {
    return entity.scheduleDays.map((sd) => sd.dayOfWeek);
  }
  return entity.dayOfWeek ? [entity.dayOfWeek] : [];
}
