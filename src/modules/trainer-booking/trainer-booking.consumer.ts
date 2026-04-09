import { Controller, Logger, NotFoundException } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  NOTIFICATION_EVENTS,
  NotificationEventPayload,
} from '../../common/events/notification.events';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';
import { TrainerBookingEntity } from './entities/trainer-booking.entity';
import { TrainerBookingService } from './trainer-booking.service';

@Controller()
export class TrainerBookingPaymentConsumer {
  private readonly logger = new Logger(TrainerBookingPaymentConsumer.name);

  constructor(
    private readonly trainerBookingService: TrainerBookingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @EventPattern('payment.success')
  async handlePaymentSuccess(
    @Payload() payload: PaymentEventPayload,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    if (payload.targetType !== 'TRAINER_BOOKING') {
      return;
    }

    try {
      await this.trainerBookingService.confirmByPayment(
        payload.targetId,
        payload.paymentId,
      );
      channel.ack(message);
    } catch (error) {
      this.handleError(error, payload, channel, message, 'payment.success');
    }
  }

  @EventPattern('payment.failed')
  async handlePaymentFailed(
    @Payload() payload: PaymentEventPayload,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    if (payload.targetType !== 'TRAINER_BOOKING') {
      return;
    }

    try {
      const changed =
        payload.failureReason === 'SESSION_EXPIRED'
          ? await this.trainerBookingService.expireByPaymentTimeout(
              payload.targetId,
              payload.paymentId,
              payload.failureReason,
            )
          : await this.trainerBookingService.failByPayment(
              payload.targetId,
              payload.paymentId,
              payload.failureReason ?? 'PAYMENT_FAILED',
            );
      if (changed) {
        if (payload.failureReason !== 'SESSION_EXPIRED') {
          await this.emitPaymentFailedNotification(changed, payload);
        }
      }
      channel.ack(message);
    } catch (error) {
      this.handleError(error, payload, channel, message, 'payment.failed');
    }
  }

  @EventPattern('payment.refunded')
  async handlePaymentRefunded(
    @Payload() payload: PaymentEventPayload,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    if (payload.targetType !== 'TRAINER_BOOKING') {
      return;
    }

    try {
      await this.trainerBookingService.cancelByRefund(
        payload.targetId,
        payload.paymentId,
      );
      channel.ack(message);
    } catch (error) {
      this.handleError(error, payload, channel, message, 'payment.refunded');
    }
  }

  private handleError(
    error: unknown,
    payload: PaymentEventPayload,
    channel: any,
    message: any,
    eventType: string,
  ) {
    if (error instanceof NotFoundException) {
      this.logger.warn(
        `[${eventType}] Trainer booking ${payload.targetId} not found, acking permanent failure`,
      );
      channel.ack(message);
      return;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(
      `[${eventType}] Transient error for trainer booking ${payload.targetId}: ${errorMessage}`,
    );
    channel.nack(message, false, false);
  }

  private async emitPaymentFailedNotification(
    booking: TrainerBookingEntity,
    payload: PaymentEventPayload,
  ): Promise<void> {
    const recipients = [
      booking.member
        ? {
            userId: booking.member.id,
            userEmail: booking.member.email,
            userName: `${booking.member.firstName} ${booking.member.lastName}`.trim(),
            message:
              'Your trainer booking payment failed. Please create a new booking request to continue.',
          }
        : null,
      booking.trainer
        ? {
            userId: booking.trainer.id,
            userEmail: booking.trainer.email,
            userName: `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
            message:
              'A trainer booking payment failed before confirmation, and the slot has been released.',
          }
        : null,
    ].filter(
      (
        recipient,
      ): recipient is {
        userId: string;
        userEmail: string;
        userName: string;
        message: string;
      } => Boolean(recipient),
    );

    await Promise.all(
      recipients.map((recipient) => {
        const eventPayload: NotificationEventPayload = {
          userId: recipient.userId,
          userEmail: recipient.userEmail,
          userName: recipient.userName,
          type: NotificationType.PAYMENT,
          title: 'Payment failed',
          message: recipient.message,
          referenceId: payload.targetId,
          metadata: {
            eventKey: NOTIFICATION_EVENTS.PAYMENT_FAILED,
            paymentId: payload.paymentId,
            targetType: payload.targetType,
            targetId: payload.targetId,
          },
        };

        return this.eventEmitter.emitAsync(
          NOTIFICATION_EVENTS.PAYMENT_FAILED,
          eventPayload,
        );
      }),
    );
  }
}
