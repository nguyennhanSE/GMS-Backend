import { DayOfWeek } from '@prisma/client';

/**
 * Bidirectional mapping between DayOfWeek enum (MON, TUE, etc.)
 * and integer (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
 *
 * TrainerAvailability.dayOfWeek is Int (0-6)
 * ScheduleDay.dayOfWeek is DayOfWeek enum (MON-SUN)
 */

const ENUM_TO_INT: Record<DayOfWeek, number> = {
  [DayOfWeek.SUN]: 0,
  [DayOfWeek.MON]: 1,
  [DayOfWeek.TUE]: 2,
  [DayOfWeek.WED]: 3,
  [DayOfWeek.THU]: 4,
  [DayOfWeek.FRI]: 5,
  [DayOfWeek.SAT]: 6,
};

const INT_TO_ENUM: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUN,
  1: DayOfWeek.MON,
  2: DayOfWeek.TUE,
  3: DayOfWeek.WED,
  4: DayOfWeek.THU,
  5: DayOfWeek.FRI,
  6: DayOfWeek.SAT,
};

export function dayOfWeekEnumToInt(day: DayOfWeek): number {
  const result = ENUM_TO_INT[day];
  if (result === undefined) {
    throw new Error(`Invalid DayOfWeek enum value: ${day}`);
  }
  return result;
}

export function dayOfWeekIntToEnum(dayInt: number): DayOfWeek {
  const result = INT_TO_ENUM[dayInt];
  if (!result) {
    throw new Error(`Invalid day of week integer: ${dayInt}. Must be 0-6.`);
  }
  return result;
}

/**
 * Parse "HH:mm" string to a Date with time component (for Prisma @db.Time)
 * Uses epoch date (1970-01-01) as the base since only time matters.
 */
export function parseTimeString(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  if (hours === undefined || minutes === undefined || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time format: ${time}. Expected HH:mm.`);
  }
  const date = new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
  return date;
}

/**
 * Format a Date (from Prisma @db.Time) to "HH:mm" string
 */
export function formatTimeToString(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
