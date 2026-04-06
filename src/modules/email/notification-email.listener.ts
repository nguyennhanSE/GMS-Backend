import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NOTIFICATION_EVENTS,
} from '../../common/events/notification.events';
import type { NotificationEventPayload } from '../../common/events/notification.events';
import { UserEmailService } from './email.service';

@Injectable()
export class NotificationEmailListener {
  private readonly logger = new Logger(NotificationEmailListener.name);

  constructor(private readonly emailService: UserEmailService) {}

  @OnEvent(NOTIFICATION_EVENTS.PAYMENT_FAILED)
  async handlePaymentFailed(payload: NotificationEventPayload): Promise<void> {
    await this.sendNotificationEmail(payload);
  }

  @OnEvent(NOTIFICATION_EVENTS.CLASS_CANCELLED)
  async handleClassCancelled(payload: NotificationEventPayload): Promise<void> {
    await this.sendNotificationEmail(payload);
  }

  @OnEvent(NOTIFICATION_EVENTS.MEMBERSHIP_EXPIRING)
  async handleMembershipExpiring(
    payload: NotificationEventPayload,
  ): Promise<void> {
    await this.sendNotificationEmail(payload);
  }

  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_CREATED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_ACCEPTED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_REJECTED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_CONFIRMED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_CANCELLED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_REMINDER)
  async handleTrainerBookingNotification(
    payload: NotificationEventPayload,
  ): Promise<void> {
    await this.sendNotificationEmail(payload);
  }

  private async sendNotificationEmail(
    payload: NotificationEventPayload,
  ): Promise<void> {
    try {
      await this.emailService.sendNotificationEmail(
        {
          id: payload.userId,
          name: payload.userName,
          email: payload.userEmail,
        },
        payload.title,
        payload.message,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send notification email for user ${payload.userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
