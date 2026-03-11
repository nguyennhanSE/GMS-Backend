import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PaymentProducer } from '../payment.producer';
import { PaymentEventPayload } from '../dto/webhook-event.dto';
import { STALE_PAYMENT_THRESHOLD_MINUTES } from '../constants/payment.constants';

@Injectable()
export class StalePaymentCronService {
  private readonly logger = new Logger(StalePaymentCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentProducer: PaymentProducer,
  ) {}

  @Cron('0 */15 * * * *')
  async sweepStalePayments() {
    const threshold = new Date();
    threshold.setMinutes(
      threshold.getMinutes() - STALE_PAYMENT_THRESHOLD_MINUTES,
    );

    const stalePayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: threshold },
      },
    });

    if (stalePayments.length === 0) return;

    this.logger.log(`Found ${stalePayments.length} stale payments to sweep`);

    for (const payment of stalePayments) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason: 'SESSION_EXPIRED',
        },
      });

      const payload: PaymentEventPayload = {
        paymentId: payment.id,
        userId: payment.userId,
        targetType: payment.targetType,
        targetId: payment.targetId,
        status: 'FAILED',
        amount: Number(payment.amount),
        currency: payment.currency,
        timestamp: new Date().toISOString(),
      };

      this.paymentProducer.emitPaymentFailed(payload);
    }

    this.logger.log(`Swept ${stalePayments.length} stale payments`);
  }
}
