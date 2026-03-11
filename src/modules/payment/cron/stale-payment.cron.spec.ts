import { Test, TestingModule } from '@nestjs/testing';
import { StalePaymentCronService } from './stale-payment.cron';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PaymentProducer } from '../payment.producer';

describe('StalePaymentCronService', () => {
  let cronService: StalePaymentCronService;
  let prisma: jest.Mocked<any>;
  let paymentProducer: jest.Mocked<any>;

  beforeEach(async () => {
    prisma = {
      payment: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    paymentProducer = {
      emitPaymentFailed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StalePaymentCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentProducer, useValue: paymentProducer },
      ],
    }).compile();

    cronService = module.get<StalePaymentCronService>(StalePaymentCronService);
  });

  it('should be defined', () => {
    expect(cronService).toBeDefined();
  });

  it('should sweep stale PENDING payments older than threshold', async () => {
    const stalePayment = {
      id: 'payment-stale',
      userId: 'user-1',
      targetType: 'CLASS_BOOKING',
      targetId: 'booking-1',
      amount: 50000,
      currency: 'VND',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 120 * 60 * 1000), // 2 hours ago
    };

    prisma.payment.findMany.mockResolvedValue([stalePayment]);
    prisma.payment.update.mockResolvedValue({
      ...stalePayment,
      status: 'FAILED',
    });

    await cronService.sweepStalePayments();

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-stale' },
      data: { status: 'FAILED', failureReason: 'SESSION_EXPIRED' },
    });
    expect(paymentProducer.emitPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'payment-stale',
        status: 'FAILED',
      }),
    );
  });

  it('should do nothing when no stale payments exist', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    await cronService.sweepStalePayments();

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(paymentProducer.emitPaymentFailed).not.toHaveBeenCalled();
  });

  it('should only query PENDING payments', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    await cronService.sweepStalePayments();

    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        createdAt: { lt: expect.any(Date) },
      },
    });
  });
});
