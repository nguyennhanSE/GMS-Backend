import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ThrottlerModule } from '@nestjs/throttler';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { StripeService } from './stripe.service';
import { PaymentProducer } from './payment.producer';
import { StalePaymentCronService } from './cron/stale-payment.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { RMQ_CLIENT_TOKEN, PAYMENT_QUEUE } from './constants/payment.constants';
import { config } from '../../libs/config';

const paymentCronProviders = config.RUN_BACKGROUND_WORKERS
  ? [StalePaymentCronService]
  : [];

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ClientsModule.register([
      {
        name: RMQ_CLIENT_TOKEN,
        transport: Transport.RMQ,
        options: {
          urls: [config.RABBITMQ_URL],
          queue: PAYMENT_QUEUE,
          queueOptions: {
            durable: true,
            deadLetterExchange: 'payment.events.dlx',
            deadLetterRoutingKey: 'payment.dlq.booking',
            messageTtl: 86400000, // 24 hours
          },
        },
      },
    ]),
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    StripeService,
    PaymentProducer,
    ...paymentCronProviders,
    PrismaService,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
