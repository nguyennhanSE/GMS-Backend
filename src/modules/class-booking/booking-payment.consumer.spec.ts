import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingPaymentConsumer } from './booking-payment.consumer';
import { ClassBookingService } from './class-booking.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';
import { NOTIFICATION_EVENTS } from '../../common/events/notification.events';

describe('BookingPaymentConsumer', () => {
  let consumer: BookingPaymentConsumer;
  let classBookingService: jest.Mocked<any>;
  let prisma: jest.Mocked<any>;
  let eventEmitter: jest.Mocked<any>;
  let mockChannel: { ack: jest.Mock; nack: jest.Mock };
  let mockMessage: Record<string, unknown>;

  const createContext = () =>
    ({
      getChannelRef: () => mockChannel,
      getMessage: () => mockMessage,
    }) as any;

  const createPayload = (
    overrides?: Partial<PaymentEventPayload>,
  ): PaymentEventPayload => ({
    paymentId: 'pay-1',
    userId: 'user-1',
    targetType: 'CLASS_BOOKING',
    targetId: 'booking-1',
    status: 'SUCCESS',
    amount: 50000,
    currency: 'VND',
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    classBookingService = {
      confirmByPayment: jest.fn(),
      cancelByPayment: jest.fn(),
    };
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
    };
    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    mockChannel = { ack: jest.fn(), nack: jest.fn() };
    mockMessage = { fields: {}, properties: {}, content: Buffer.from('') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingPaymentConsumer,
        { provide: ClassBookingService, useValue: classBookingService },
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    consumer = module.get<BookingPaymentConsumer>(BookingPaymentConsumer);
  });

  it('should be defined', () => {
    expect(consumer).toBeDefined();
  });

  describe('handlePaymentSuccess', () => {
    it('should confirm booking and ack on success', async () => {
      const payload = createPayload();
      classBookingService.confirmByPayment.mockResolvedValue({});

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(classBookingService.confirmByPayment).toHaveBeenCalledWith(
        'booking-1',
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should skip non-booking events without touching ack state', async () => {
      const payload = createPayload({ targetType: 'MEMBERSHIP' as any });

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(classBookingService.confirmByPayment).not.toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should ack on NotFoundException (permanent failure)', async () => {
      const payload = createPayload();
      classBookingService.confirmByPayment.mockRejectedValue(
        new NotFoundException('Booking not found'),
      );

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should nack to DLQ on transient error', async () => {
      const payload = createPayload();
      classBookingService.confirmByPayment.mockRejectedValue(
        new Error('Connection refused'),
      );

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, false);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentFailed', () => {
    it('should cancel booking and ack on success', async () => {
      const payload = createPayload({ status: 'FAILED' as any });
      classBookingService.cancelByPayment.mockResolvedValue({
        id: 'booking-1',
        status: 'cancelled',
        userId: 'user-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'member@test.local',
        firstName: 'Test',
        lastName: 'Member',
      });

      await consumer.handlePaymentFailed(payload, createContext());

      expect(classBookingService.cancelByPayment).toHaveBeenCalledWith(
        'booking-1',
        'PAYMENT_FAILED',
      );
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.PAYMENT_FAILED,
        expect.objectContaining({
          userId: 'user-1',
          userEmail: 'member@test.local',
          referenceId: 'booking-1',
        }),
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should not emit a local notification event when booking state did not change', async () => {
      const payload = createPayload({ status: 'FAILED' });
      classBookingService.cancelByPayment.mockResolvedValue(null);

      await consumer.handlePaymentFailed(payload, createContext());

      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });
  });

  describe('handlePaymentRefunded', () => {
    it('should cancel booking and ack on success', async () => {
      const payload = createPayload({ status: 'REFUNDED' });
      classBookingService.cancelByPayment.mockResolvedValue({
        id: 'booking-1',
        status: 'cancelled',
        userId: 'user-1',
      });

      await consumer.handlePaymentRefunded(payload, createContext());

      expect(classBookingService.cancelByPayment).toHaveBeenCalledWith(
        'booking-1',
        'PAYMENT_REFUNDED',
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should nack to DLQ on transient error (refund path)', async () => {
      const payload = createPayload({ status: 'REFUNDED' });
      classBookingService.cancelByPayment.mockRejectedValue(
        new Error('DB timeout'),
      );

      await consumer.handlePaymentRefunded(payload, createContext());

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, false);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });
  });
});
