import { Controller, Logger, NotFoundException } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { MembershipsService } from './memberships.service';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';

@Controller()
export class MembershipPaymentConsumer {
  private readonly logger = new Logger(MembershipPaymentConsumer.name);

  constructor(private readonly membershipsService: MembershipsService) {}

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
      channel.ack(message);
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
      channel.ack(message);
      return;
    }

    try {
      await this.membershipsService.deactivateByPayment(payload.paymentId);
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
      channel.ack(message);
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
}
