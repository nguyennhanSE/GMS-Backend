import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PaymentProducer } from './payment.producer';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { PaymentEventPayload } from './dto/webhook-event.dto';
import { STALE_PAYMENT_THRESHOLD_MINUTES } from './constants/payment.constants';
import { PaymentStatus, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS } from '../trainer-booking/constants/trainer-booking.constants';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly paymentProducer: PaymentProducer,
  ) {}

  async createCheckout(userId: string, dto: CreateCheckoutDto) {
    const normalizedDto = await this.normalizeCheckoutRequest(userId, dto);
    const amount = normalizedDto.amount;
    const currency = normalizedDto.currency ?? 'VND';

    if (amount === undefined) {
      throw new BadRequestException('Payment amount is required');
    }

    // Dedup: return existing valid session or expire stale ones
    const existing = await this.prisma.payment.findFirst({
      where: {
        targetType: normalizedDto.targetType,
        targetId: normalizedDto.targetId,
        status: 'PENDING',
      },
    });

    if (existing) {
      const ageMinutes = (Date.now() - existing.createdAt.getTime()) / 60000;
      const staleThresholdMinutes = this.getStalePaymentThresholdMinutes(
        normalizedDto.targetType,
      );
      if (
        ageMinutes < staleThresholdMinutes &&
        existing.checkoutUrl
      ) {
        this.logger.log(
          `Returning existing checkout for payment ${existing.id}`,
        );
        return { checkoutUrl: existing.checkoutUrl };
      }
      // Expired — mark FAILED so a new one can be created
      await this.prisma.payment.update({
        where: { id: existing.id },
        data: { status: 'FAILED', failureReason: 'SESSION_EXPIRED' },
      });
      this.logger.log(
        `Expired stale payment ${existing.id}, creating new session`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        targetType: normalizedDto.targetType,
        targetId: normalizedDto.targetId,
        amount,
        currency,
        status: 'PENDING',
      },
    });

    const session = await this.stripeService.createCheckoutSession({
      paymentId: payment.id,
      userId,
      targetType: normalizedDto.targetType,
      targetId: normalizedDto.targetId,
      amount,
      currency,
      productName: `${normalizedDto.targetType} Payment`,
    });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerSessionId: session.id, checkoutUrl: session.url },
    });

    this.logger.log(
      `Checkout created: payment=${payment.id}, session=${session.id}`,
    );

    return { checkoutUrl: session.url };
  }

  private async normalizeCheckoutRequest(
    userId: string,
    dto: CreateCheckoutDto,
  ): Promise<CreateCheckoutDto> {
    if (dto.targetType !== 'TRAINER_BOOKING') {
      return dto;
    }

    const booking = await this.prisma.trainerBooking.findUnique({
      where: { id: dto.targetId },
    });

    if (!booking) {
      throw new NotFoundException(`Trainer booking ${dto.targetId} not found`);
    }

    if (booking.memberId !== userId) {
      throw new ForbiddenException(
        "Cannot initiate payment for another member's trainer booking",
      );
    }

    if (this.hasTrainerBookingPaymentWindowExpired(booking)) {
      await this.expireTrainerBookingPaymentWindow(booking.id);
      throw new BadRequestException(
        'Trainer booking payment window expired. Create a new booking request to continue.',
      );
    }

    if (booking.status !== 'ACCEPTED_PENDING_PAYMENT') {
      throw new BadRequestException(
        `Trainer booking is '${booking.status}', payment can only start after trainer acceptance`,
      );
    }

    return {
      ...dto,
      amount: Number(booking.price),
      currency: booking.currency,
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    let event: Stripe.Event;

    try {
      event = this.stripeService.verifyWebhookSignature(rawBody, signature);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Webhook signature verification failed: ${message}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log(`Webhook received: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleSessionCompleted(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(event);
        break;
      case 'checkout.session.expired':
        await this.handleSessionExpired(event.data.object);
        break;
      case 'charge.refunded':
        await this.handleChargeRefunded(event);
        break;
      default:
        this.logger.warn(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleSessionCompleted(session: Stripe.Checkout.Session) {
    const payment = await this.findPaymentBySessionId(session.id);
    if (!payment) return;

    // Idempotency: skip if already SUCCESS
    if (payment.status === 'SUCCESS') {
      this.logger.log(
        `Payment ${payment.id} already SUCCESS — skipping duplicate webhook`,
      );
      return;
    }

    // Resurrection: FAILED → SUCCESS (late webhook after cron sweep)
    if (payment.status === 'REFUNDED') {
      this.logger.log(
        `Payment ${payment.id} is REFUNDED (terminal) — skipping`,
      );
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESS',
        paidAt: new Date(),
        providerPaymentId: session.payment_intent as string,
        metadata: JSON.parse(JSON.stringify(session)) as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Payment ${payment.id} marked SUCCESS (was ${payment.status})`,
    );
    void this.emitEvent(payment.id, 'SUCCESS');
  }

  private async handlePaymentFailed(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const payment = await this.findPaymentForFailedIntent(paymentIntent);
    if (!payment) return;

    if (
      payment.status === 'SUCCESS' ||
      payment.status === 'FAILED' ||
      payment.status === 'REFUNDED'
    ) {
      this.logger.log(
        `Payment ${payment.id} is ${payment.status} — skipping failed event`,
      );
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: 'PAYMENT_DECLINED',
        providerPaymentId: paymentIntent.id,
        metadata: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Payment ${payment.id} marked FAILED`);
    void this.emitEvent(payment.id, 'FAILED');
  }

  private async handleSessionExpired(session: Stripe.Checkout.Session) {
    const payment = await this.findPaymentBySessionId(session.id);
    if (!payment) return;

    if (payment.status !== 'PENDING') {
      this.logger.log(
        `Payment ${payment.id} is ${payment.status} — skipping expired event`,
      );
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: 'SESSION_EXPIRED',
        metadata: JSON.parse(JSON.stringify(session)) as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Payment ${payment.id} marked FAILED (session expired)`);
    void this.emitEvent(payment.id, 'FAILED');
  }

  private async handleChargeRefunded(event: Stripe.Event) {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = charge.payment_intent as string;

    const payment = await this.prisma.payment.findUnique({
      where: { providerPaymentId: paymentIntentId },
    });

    if (!payment) {
      this.logger.warn(
        `No payment found for paymentIntent: ${paymentIntentId}`,
      );
      return;
    }

    if (payment.status === 'REFUNDED') {
      this.logger.log(`Payment ${payment.id} already REFUNDED — skipping`);
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REFUNDED',
        metadata: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Payment ${payment.id} marked REFUNDED`);
    void this.emitEvent(payment.id, 'REFUNDED');
  }

  private async findPaymentBySessionId(sessionId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerSessionId: sessionId },
    });

    if (!payment) {
      this.logger.warn(`No payment found for session: ${sessionId}`);
    }

    return payment;
  }

  private async findPaymentForFailedIntent(intent: Stripe.PaymentIntent) {
    const paymentIdFromMetadata = intent.metadata?.paymentId;
    let payment = paymentIdFromMetadata
      ? await this.prisma.payment.findUnique({
          where: { id: paymentIdFromMetadata },
        })
      : null;

    if (!payment && intent.id) {
      payment = await this.prisma.payment.findUnique({
        where: { providerPaymentId: intent.id },
      });
    }

    if (!payment) {
      this.logger.warn(`No payment found for failed payment intent: ${intent.id}`);
    }

    return payment;
  }

  private getStalePaymentThresholdMinutes(targetType: string): number {
    if (targetType === 'TRAINER_BOOKING') {
      return TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS / 60000;
    }

    return STALE_PAYMENT_THRESHOLD_MINUTES;
  }

  private hasTrainerBookingPaymentWindowExpired(booking: {
    startAt: Date;
    updatedAt: Date;
  }): boolean {
    const now = Date.now();
    return (
      booking.startAt.getTime() <= now ||
      booking.updatedAt.getTime() + TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS <= now
    );
  }

  private async expireTrainerBookingPaymentWindow(bookingId: string): Promise<void> {
    await this.prisma.trainerBooking.updateMany({
      where: {
        id: bookingId,
        status: 'ACCEPTED_PENDING_PAYMENT',
      },
      data: {
        status: 'EXPIRED',
        cancelReason: 'SESSION_EXPIRED',
      },
    });
  }

  private async emitEvent(paymentId: string, status: PaymentStatus) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) return;

    const payload: PaymentEventPayload = {
      paymentId: payment.id,
      userId: payment.userId,
      targetType: payment.targetType,
      targetId: payment.targetId,
      status: payment.status,
      amount: Number(payment.amount),
      currency: payment.currency,
      failureReason: payment.failureReason,
      timestamp: new Date().toISOString(),
    };

    switch (status) {
      case 'SUCCESS':
        this.paymentProducer.emitPaymentSuccess(payload);
        break;
      case 'FAILED':
        this.paymentProducer.emitPaymentFailed(payload);
        break;
      case 'REFUNDED':
        this.paymentProducer.emitPaymentRefunded(payload);
        break;
    }
  }
}
