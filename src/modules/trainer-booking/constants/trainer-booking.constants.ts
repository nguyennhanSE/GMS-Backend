import { TrainerBookingStatus } from '@prisma/client';

export const TRAINER_BOOKING_SUPPORTED_DURATIONS = [30, 60, 90] as const;

export const TRAINER_BOOKING_DEFAULT_PRICING: Record<
  (typeof TRAINER_BOOKING_SUPPORTED_DURATIONS)[number],
  number
> = {
  30: 150000,
  60: 250000,
  90: 350000,
};

export const TRAINER_BOOKING_DEFAULT_CURRENCY = 'VND';

export const TRAINER_BOOKING_BLOCKING_STATUSES: TrainerBookingStatus[] = [
  'PENDING_REVIEW',
  'ACCEPTED_PENDING_PAYMENT',
  'CONFIRMED',
];

export const TRAINER_BOOKING_NON_BLOCKING_STATUSES: TrainerBookingStatus[] = [
  'REJECTED',
  'PAYMENT_FAILED',
  'CANCELLED',
  'EXPIRED',
  'COMPLETED',
  'NO_SHOW',
];

export const TRAINER_BOOKING_PENDING_REVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS = 30 * 60 * 1000;
export const TRAINER_BOOKING_MESSAGE_WINDOW_DAYS = 30;
export const TRAINER_BOOKING_REMINDER_LOOKAHEAD_HOURS = 24;
export const TRAINER_BOOKING_REMINDER_TITLE = 'Upcoming trainer session reminder';
