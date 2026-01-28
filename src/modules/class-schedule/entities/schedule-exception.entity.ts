import { ExceptionType } from '@prisma/client';

/**
 * Entity representing a schedule exception (holiday, closure, reschedule)
 */
export class ScheduleExceptionEntity {
  id!: string;
  scheduleId!: string;
  exceptionDate!: Date;
  type!: ExceptionType;
  reason?: string | null;
  newStartTime?: Date | null;
  newEndTime?: Date | null;
  createdAt!: Date;
  updatedAt?: Date | null;
}
