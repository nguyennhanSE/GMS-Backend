import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PaymentProducer } from './payment.producer';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { PaymentEventPayload } from './dto/webhook-event.dto';
import { STALE_PAYMENT_THRESHOLD_MINUTES } from './constants/payment.constants';
import { PaymentStatus, Prisma } from '@prisma/client';
import Stripe from 'stripe';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly paymentProducer: PaymentProducer,
  ) {}

  async createCheckout(userId: string, dto: CreateCheckoutDto) {
    // Dedup: return existing valid session or expire stale ones
    const existing = await this.prisma.payment.findFirst({
      where: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: 'PENDING',
      },
    });

    if (existing) {
      const ageMinutes = (Date.now() - existing.createdAt.getTime()) / 60000;
      if (
        ageMinutes < STALE_PAYMENT_THRESHOLD_MINUTES &&
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
        targetType: dto.targetType,
        targetId: dto.targetId,
        amount: dto.amount,
        currency: dto.currency ?? 'VND',
        status: 'PENDING',
      },
    });

    const session = await this.stripeService.createCheckoutSession({
      paymentId: payment.id,
      userId,
      targetType: dto.targetType,
      targetId: dto.targetId,
      amount: dto.amount,
      currency: dto.currency ?? 'VND',
      productName: `${dto.targetType} Payment`,
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
    const session = event.data.object as Stripe.Checkout.Session;
    const payment = await this.findPaymentBySessionId(session.id);
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
