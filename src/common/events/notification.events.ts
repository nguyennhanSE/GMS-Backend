import { NotificationType } from '@prisma/client';

export const NOTIFICATION_EVENTS = {
  PAYMENT_FAILED: 'notification.payment.failed',
  CLASS_CANCELLED: 'notification.class.cancelled',
  MEMBERSHIP_EXPIRING: 'notification.membership.expiring',
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
