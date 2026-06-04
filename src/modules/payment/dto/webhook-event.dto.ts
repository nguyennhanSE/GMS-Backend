import { PaymentTargetType, PaymentStatus } from '@prisma/client';

export interface PaymentEventPayload {
  paymentId: string;
  userId: string | null;
  targetType: PaymentTargetType;
  targetId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  failureReason?: string | null;
  timestamp: string;
}

export type StripeEventType =
  | 'checkout.session.completed'
  | 'payment_intent.payment_failed'
  | 'checkout.session.expired'
  | 'charge.refunded';
