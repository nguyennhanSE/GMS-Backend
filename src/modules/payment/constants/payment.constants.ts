export const PAYMENT_EXCHANGE = 'payment.events';
export const PAYMENT_QUEUE = 'payment.events.booking';
export const RMQ_CLIENT_TOKEN = 'PAYMENT_RMQ_CLIENT';

export const ROUTING_KEYS = {
  SUCCESS: 'payment.success',
  FAILED: 'payment.failed',
  REFUNDED: 'payment.refunded',
} as const;

export const STALE_PAYMENT_THRESHOLD_MINUTES = 60;

export const HANDLED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'payment_intent.payment_failed',
  'checkout.session.expired',
  'charge.refunded',
] as const;
