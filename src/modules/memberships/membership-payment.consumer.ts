import { Controller, Logger, NotFoundException } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { MembershipsService } from './memberships.service';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  NOTIFICATION_EVENTS,
  NotificationEventPayload,
} from '../../common/events/notification.events';

@Controller()
export class MembershipPaymentConsumer {
  private readonly logger = new Logger(MembershipPaymentConsumer.name);

  constructor(
    private readonly membershipsService: MembershipsService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @EventPattern('payment.success')
  async handlePaymentSuccess(
    @Payload() payload: PaymentEventPayload,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    if (payload.targetType !== 'MEMBERSHIP') {
      this.logger.log(
        `Skipping non-membership event (targetType: ${payload.targetType})`,
      );
      return;
    }

    try {
      await this.membershipsService.activateByPayment(
        payload.paymentId,
        payload.userId,
        payload.targetId,
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

    if (payload.targetType !== 'MEMBERSHIP') {
      this.logger.log(
        `Skipping non-membership event (targetType: ${payload.targetType})`,
      );
      return;
    }

    try {
      const changed = await this.membershipsService.deactivateByPayment(
        payload.paymentId,
      );
      if (changed) {
        await this.emitPaymentFailedNotification(payload);
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

    if (payload.targetType !== 'MEMBERSHIP') {
      this.logger.log(
        `Skipping non-membership event (targetType: ${payload.targetType})`,
      );
      return;
    }

    try {
      await this.membershipsService.deactivateByPayment(payload.paymentId);
      channel.ack(message);
    } catch (error) {
      this.handleError(error, payload, channel, message, 'payment.refunded');
    }
  }

  /**
   * Error classification:
   * - NotFoundException → permanent failure → ack (retrying won't help)
   * - Everything else → transient failure → nack to DLQ (retryable)
   */
  private handleError(
    error: unknown,
    payload: PaymentEventPayload,
    channel: any,
    message: any,
    eventType: string,
  ) {
    if (error instanceof NotFoundException) {
      this.logger.warn(
        `[${eventType}] Membership ${payload.targetId} not found — acking (permanent failure)`,
      );
      channel.ack(message);
    } else {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[${eventType}] Transient error for membership ${payload.targetId} — nacking to DLQ: ${errorMsg}`,
      );
      channel.nack(message, false, false);
    }
  }

  private async emitPaymentFailedNotification(
    payload: PaymentEventPayload,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!user) {
      this.logger.warn(
        `[payment.failed] User ${payload.userId} not found for notification`,
      );
      return;
    }

    const eventPayload: NotificationEventPayload = {
      userId: user.id,
      userEmail: user.email,
      userName: `${user.firstName} ${user.lastName}`.trim(),
      type: NotificationType.PAYMENT,
      title: 'Payment failed',
      message:
        'Your membership payment failed. Please update your card details and try again.',
      referenceId: payload.targetId,
      metadata: {
        eventKey: NOTIFICATION_EVENTS.PAYMENT_FAILED,
        paymentId: payload.paymentId,
        targetType: payload.targetType,
        targetId: payload.targetId,
      },
    };

    await this.eventEmitter.emitAsync(
      NOTIFICATION_EVENTS.PAYMENT_FAILED,
      eventPayload,
    );
  }
}
