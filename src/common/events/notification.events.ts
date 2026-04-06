import { NotificationType } from '@prisma/client';

export const NOTIFICATION_EVENTS = {
  PAYMENT_FAILED: 'notification.payment.failed',
  CLASS_CANCELLED: 'notification.class.cancelled',
  MEMBERSHIP_EXPIRING: 'notification.membership.expiring',
  TRAINER_BOOKING_CREATED: 'notification.trainer-booking.created',
  TRAINER_BOOKING_ACCEPTED: 'notification.trainer-booking.accepted',
  TRAINER_BOOKING_REJECTED: 'notification.trainer-booking.rejected',
  TRAINER_BOOKING_CONFIRMED: 'notification.trainer-booking.confirmed',
  TRAINER_BOOKING_CANCELLED: 'notification.trainer-booking.cancelled',
  TRAINER_BOOKING_REMINDER: 'notification.trainer-booking.reminder',
} as const;

export interface NotificationEventPayload {
  userId: string;
  userEmail: string;
  userName: string;
  type: NotificationType;
  title: string;
  message: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}
