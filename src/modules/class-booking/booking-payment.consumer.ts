import { Controller, Logger, NotFoundException } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { ClassBookingService } from './class-booking.service';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';

@Controller()
export class BookingPaymentConsumer {
  private readonly logger = new Logger(BookingPaymentConsumer.name);

  constructor(private readonly classBookingService: ClassBookingService) {}

  @EventPattern('payment.success')
  async handlePaymentSuccess(
    @Payload() payload: PaymentEventPayload,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    if (payload.targetType !== 'CLASS_BOOKING') {
      this.logger.log(
        `Skipping non-booking event (targetType: ${payload.targetType})`,
      );
      channel.ack(message);
      return;
    }

    try {
      await this.classBookingService.confirmByPayment(payload.targetId);
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

    if (payload.targetType !== 'CLASS_BOOKING') {
      this.logger.log(
        `Skipping non-booking event (targetType: ${payload.targetType})`,
      );
      channel.ack(message);
      return;
    }

    try {
      await this.classBookingService.cancelByPayment(
        payload.targetId,
        'PAYMENT_FAILED',
      );
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

    if (payload.targetType !== 'CLASS_BOOKING') {
      this.logger.log(
        `Skipping non-booking event (targetType: ${payload.targetType})`,
      );
      channel.ack(message);
      return;
    }

    try {
      await this.classBookingService.cancelByPayment(
        payload.targetId,
        'PAYMENT_REFUNDED',
      );
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
        `[${eventType}] Booking ${payload.targetId} not found — acking (permanent failure)`,
      );
      channel.ack(message);
    } else {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[${eventType}] Transient error for booking ${payload.targetId} — nacking to DLQ: ${errorMsg}`,
      );
      channel.nack(message, false, false);
    }
  }
}
