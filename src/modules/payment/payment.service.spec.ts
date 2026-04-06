import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PaymentProducer } from './payment.producer';
import { UnauthorizedException } from '@nestjs/common';
import Stripe from 'stripe';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: jest.Mocked<any>;
  let stripeService: jest.Mocked<any>;
  let paymentProducer: jest.Mocked<any>;

  const mockPayment = {
    id: 'payment-1',
    userId: 'user-1',
    targetType: 'CLASS_BOOKING',
    targetId: 'booking-1',
    amount: 50000,
    currency: 'VND',
    status: 'PENDING',
    providerSessionId: 'cs_test_123',
    providerPaymentId: null,
    checkoutUrl: 'https://checkout.stripe.com/test',
    paidAt: null,
    failureReason: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      payment: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      trainerBooking: {
        findUnique: jest.fn(),
      },
    };

    stripeService = {
      createCheckoutSession: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    };

    paymentProducer = {
      emitPaymentSuccess: jest.fn(),
      emitPaymentFailed: jest.fn(),
      emitPaymentRefunded: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripeService },
        { provide: PaymentProducer, useValue: paymentProducer },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createCheckout', () => {
    const checkoutDto = {
      targetType: 'CLASS_BOOKING' as any,
      targetId: 'booking-1',
      amount: 50000,
      currency: 'VND',
    };

    it('should create new payment when no existing pending', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue(mockPayment);
      prisma.payment.update.mockResolvedValue(mockPayment);
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      });

      const result = await service.createCheckout('user-1', checkoutDto);

      expect(result).toEqual({
        checkoutUrl: 'https://checkout.stripe.com/test',
      });
      expect(prisma.payment.create).toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            checkoutUrl: 'https://checkout.stripe.com/test',
          }),
        }),
      );
    });

    it('should return existing URL when fresh pending payment exists', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        createdAt: new Date(), // just now — fresh
      });

      const result = await service.createCheckout('user-1', checkoutDto);

      expect(result).toEqual({
        checkoutUrl: 'https://checkout.stripe.com/test',
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('should expire stale payment and create new one', async () => {
      const staleDate = new Date(Date.now() - 120 * 60 * 1000); // 2 hours ago
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        createdAt: staleDate,
      });
      prisma.payment.update.mockResolvedValue(mockPayment);
      prisma.payment.create.mockResolvedValue({
        ...mockPayment,
        id: 'payment-2',
      });
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_test_new',
        url: 'https://checkout.stripe.com/new',
      });

      const result = await service.createCheckout('user-1', checkoutDto);

      expect(result).toEqual({
        checkoutUrl: 'https://checkout.stripe.com/new',
      });
      // Should have expired the old payment
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { status: 'FAILED', failureReason: 'SESSION_EXPIRED' },
      });
      // Should have created a new one
      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it('should derive amount and enforce ownership for trainer bookings', async () => {
      prisma.trainerBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        memberId: 'user-1',
        trainerId: 'trainer-1',
        status: 'ACCEPTED_PENDING_PAYMENT',
        price: 250000,
        currency: 'VND',
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        updatedAt: new Date(),
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue({
        ...mockPayment,
        targetType: 'TRAINER_BOOKING',
        amount: 250000,
        currency: 'VND',
      });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        targetType: 'TRAINER_BOOKING',
        amount: 250000,
      });
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_test_trainer',
        url: 'https://checkout.stripe.com/trainer',
      });

      const result = await service.createCheckout('user-1', {
        targetType: 'TRAINER_BOOKING' as any,
        targetId: 'booking-1',
        amount: 1,
        currency: 'USD',
      });

      expect(result).toEqual({
        checkoutUrl: 'https://checkout.stripe.com/trainer',
      });
      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 250000,
          currency: 'VND',
          productName: 'TRAINER_BOOKING Payment',
        }),
      );
    });

    it('should reject trainer booking checkout for a non-owner', async () => {
      prisma.trainerBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        memberId: 'other-user',
        trainerId: 'trainer-1',
        status: 'ACCEPTED_PENDING_PAYMENT',
        price: 250000,
        currency: 'VND',
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        updatedAt: new Date(),
      });

      await expect(
        service.createCheckout('user-1', {
          targetType: 'TRAINER_BOOKING' as any,
          targetId: 'booking-1',
          amount: 250000,
          currency: 'VND',
        }),
      ).rejects.toThrow();
    });
  });

  describe('handleWebhook', () => {
    const rawBody = Buffer.from('test');
    const signature = 'whsec_test_signature';

    it('should throw UnauthorizedException on invalid signature', async () => {
      stripeService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should mark payment SUCCESS on checkout.session.completed', async () => {
      const event = {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_123', payment_intent: 'pi_test_456' } },
      } as unknown as Stripe.Event;

      stripeService.verifyWebhookSignature.mockReturnValue(event);
      prisma.payment.findUnique
        .mockResolvedValueOnce({ ...mockPayment, status: 'PENDING' }) // findBySessionId
        .mockResolvedValueOnce({ ...mockPayment, status: 'SUCCESS' }); // emitEvent re-fetch
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: 'SUCCESS',
      });

      await service.handleWebhook(rawBody, signature);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ status: 'SUCCESS' }),
      });
      // emitEvent is void/async, verify producer was called
      await new Promise((r) => setTimeout(r, 50));
      expect(paymentProducer.emitPaymentSuccess).toHaveBeenCalled();
    });

    it('should skip duplicate SUCCESS webhooks (idempotency)', async () => {
      const event = {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_123' } },
      } as unknown as Stripe.Event;

      stripeService.verifyWebhookSignature.mockReturnValue(event);
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: 'SUCCESS',
      });

      await service.handleWebhook(rawBody, signature);

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(paymentProducer.emitPaymentSuccess).not.toHaveBeenCalled();
    });

    it('should resurrect FAILED → SUCCESS on late webhook', async () => {
      const event = {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_123', payment_intent: 'pi_test_456' } },
      } as unknown as Stripe.Event;

      stripeService.verifyWebhookSignature.mockReturnValue(event);
      prisma.payment.findUnique
        .mockResolvedValueOnce({ ...mockPayment, status: 'FAILED' }) // findBySessionId
        .mockResolvedValueOnce({ ...mockPayment, status: 'SUCCESS' }); // emitEvent re-fetch
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: 'SUCCESS',
      });

      await service.handleWebhook(rawBody, signature);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ status: 'SUCCESS' }),
      });
    });

    it('should skip REFUNDED payments (terminal state)', async () => {
      const event = {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_123' } },
      } as unknown as Stripe.Event;

      stripeService.verifyWebhookSignature.mockReturnValue(event);
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: 'REFUNDED',
      });

      await service.handleWebhook(rawBody, signature);

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('should mark payment FAILED on payment_intent.payment_failed', async () => {
      const event = {
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_456',
            metadata: { paymentId: 'payment-1' },
          },
        },
      } as unknown as Stripe.Event;

      stripeService.verifyWebhookSignature.mockReturnValue(event);
      prisma.payment.findUnique
        .mockResolvedValueOnce({ ...mockPayment, status: 'PENDING' })
        .mockResolvedValueOnce({ ...mockPayment, status: 'FAILED' });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: 'FAILED',
      });

      await service.handleWebhook(rawBody, signature);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'PAYMENT_DECLINED',
          providerPaymentId: 'pi_test_456',
        }),
      });
    });

    it('should mark payment FAILED on checkout.session.expired', async () => {
      const event = {
        type: 'checkout.session.expired',
        data: { object: { id: 'cs_test_123' } },
      } as unknown as Stripe.Event;

      stripeService.verifyWebhookSignature.mockReturnValue(event);
      prisma.payment.findUnique
        .mockResolvedValueOnce({ ...mockPayment, status: 'PENDING' })
        .mockResolvedValueOnce({ ...mockPayment, status: 'FAILED' });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: 'FAILED',
      });

      await service.handleWebhook(rawBody, signature);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'SESSION_EXPIRED',
        }),
      });
    });

    it('should mark payment REFUNDED on charge.refunded', async () => {
      const event = {
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_test_456' } },
      } as unknown as Stripe.Event;

      stripeService.verifyWebhookSignature.mockReturnValue(event);
      prisma.payment.findUnique
        .mockResolvedValueOnce({
          ...mockPayment,
          status: 'SUCCESS',
          providerPaymentId: 'pi_test_456',
        })
        .mockResolvedValueOnce({ ...mockPayment, status: 'REFUNDED' });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: 'REFUNDED',
      });

      await service.handleWebhook(rawBody, signature);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ status: 'REFUNDED' }),
      });
    });
  });
});
