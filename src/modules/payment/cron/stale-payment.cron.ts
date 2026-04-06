import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PaymentProducer } from '../payment.producer';
import { PaymentEventPayload } from '../dto/webhook-event.dto';
import { STALE_PAYMENT_THRESHOLD_MINUTES } from '../constants/payment.constants';
import { TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS } from '../../trainer-booking/constants/trainer-booking.constants';

@Injectable()
export class StalePaymentCronService {
  private readonly logger = new Logger(StalePaymentCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentProducer: PaymentProducer,
  ) {}

  @Cron('0 */15 * * * *')
  async sweepStalePayments() {
    const stalePayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
      },
    });

    if (stalePayments.length === 0) return;

    this.logger.log(`Found ${stalePayments.length} stale payments to sweep`);
    let sweptCount = 0;

    for (const payment of stalePayments) {
      if (!(await this.shouldExpirePayment(payment, new Date()))) {
        continue;
      }

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
        failureReason: 'SESSION_EXPIRED',
        timestamp: new Date().toISOString(),
      };

      this.paymentProducer.emitPaymentFailed(payload);
      sweptCount += 1;
    }

    if (sweptCount > 0) {
      this.logger.log(`Swept ${sweptCount} stale payments`);
    }
  }

  private async shouldExpirePayment(
    payment: {
      createdAt: Date;
      targetId: string;
      targetType: string;
    },
    now: Date,
  ): Promise<boolean> {
    if (payment.targetType !== 'TRAINER_BOOKING') {
      return (
        payment.createdAt.getTime() <=
        now.getTime() - STALE_PAYMENT_THRESHOLD_MINUTES * 60 * 1000
      );
    }

    const booking = await this.prisma.trainerBooking.findUnique({
      where: { id: payment.targetId },
      select: {
        status: true,
        startAt: true,
        updatedAt: true,
      },
    });

    if (!booking) {
      return (
        payment.createdAt.getTime() <=
        now.getTime() - TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS
      );
    }

    if (booking.status !== 'ACCEPTED_PENDING_PAYMENT') {
      return true;
    }

    return (
      booking.startAt.getTime() <= now.getTime() ||
      booking.updatedAt.getTime() + TRAINER_BOOKING_PENDING_PAYMENT_TTL_MS <=
        now.getTime()
    );
  }
}
