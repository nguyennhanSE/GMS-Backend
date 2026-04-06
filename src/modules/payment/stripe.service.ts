import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { config } from '../../libs/config';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor() {
    this.stripe = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: '2026-02-25.clover',
    });
  }

  async createCheckoutSession(params: {
    paymentId: string;
    userId: string;
    targetType: string;
    targetId: string;
    amount: number;
    currency: string;
    productName: string;
  }): Promise<Stripe.Checkout.Session> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            unit_amount: params.amount,
            product_data: { name: params.productName },
          },
          quantity: 1,
        },
      ],
      success_url: `${config.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: config.STRIPE_CANCEL_URL,
      metadata: {
        paymentId: params.paymentId,
        targetType: params.targetType,
        targetId: params.targetId,
        userId: params.userId,
      },
      payment_intent_data: {
        metadata: {
          paymentId: params.paymentId,
          targetType: params.targetType,
          targetId: params.targetId,
          userId: params.userId,
        },
      },
    });

    this.logger.log(`Checkout session created: ${session.id}`);
    return session;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.STRIPE_WEBHOOK_SECRET,
    );
  }
}
