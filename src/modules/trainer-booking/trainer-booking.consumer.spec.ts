import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NOTIFICATION_EVENTS } from '../../common/events/notification.events';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';
import { TrainerBookingPaymentConsumer } from './trainer-booking.consumer';
import { TrainerBookingService } from './trainer-booking.service';

describe('TrainerBookingPaymentConsumer', () => {
  let consumer: TrainerBookingPaymentConsumer;
  let trainerBookingService: jest.Mocked<any>;
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
    userId: 'member-1',
    targetType: 'TRAINER_BOOKING',
    targetId: 'booking-1',
    status: 'SUCCESS',
    amount: 250000,
    currency: 'VND',
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    trainerBookingService = {
      confirmByPayment: jest.fn(),
      failByPayment: jest.fn(),
      expireByPaymentTimeout: jest.fn(),
      cancelByRefund: jest.fn(),
    };
    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    mockChannel = { ack: jest.fn(), nack: jest.fn() };
    mockMessage = { fields: {}, properties: {}, content: Buffer.from('') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerBookingPaymentConsumer,
        { provide: TrainerBookingService, useValue: trainerBookingService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    consumer = module.get(TrainerBookingPaymentConsumer);
  });

  it('confirms trainer bookings on payment success and acks the message', async () => {
    const payload = createPayload();
    trainerBookingService.confirmByPayment.mockResolvedValue({});

    await consumer.handlePaymentSuccess(payload, createContext());

    expect(trainerBookingService.confirmByPayment).toHaveBeenCalledWith(
      'booking-1',
      'pay-1',
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('skips non-trainer-booking payment events', async () => {
    const payload = createPayload({ targetType: 'MEMBERSHIP' as any });

    await consumer.handlePaymentSuccess(payload, createContext());

    expect(trainerBookingService.confirmByPayment).not.toHaveBeenCalled();
    expect(mockChannel.ack).not.toHaveBeenCalled();
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('emits a payment failed notification when the booking state changes', async () => {
    const payload = createPayload({
      status: 'FAILED' as any,
      failureReason: 'PAYMENT_DECLINED',
    });
    trainerBookingService.failByPayment.mockResolvedValue({
      id: 'booking-1',
      status: 'PAYMENT_FAILED',
      member: {
        id: 'member-1',
        email: 'member@test.local',
        firstName: 'Test',
        lastName: 'Member',
      },
      trainer: {
        id: 'trainer-1',
        email: 'trainer@test.local',
        firstName: 'Coach',
        lastName: 'Trainer',
      },
    });

    await consumer.handlePaymentFailed(payload, createContext());

    expect(trainerBookingService.failByPayment).toHaveBeenCalledWith(
      'booking-1',
      'pay-1',
      'PAYMENT_DECLINED',
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.PAYMENT_FAILED,
      expect.objectContaining({
        userId: 'member-1',
        userEmail: 'member@test.local',
        referenceId: 'booking-1',
      }),
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.PAYMENT_FAILED,
      expect.objectContaining({
        userId: 'trainer-1',
        userEmail: 'trainer@test.local',
        referenceId: 'booking-1',
      }),
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
  });

  it('marks the booking expired for session-expired payment failures without sending payment-failed notifications', async () => {
    const payload = createPayload({
      status: 'FAILED' as any,
      failureReason: 'SESSION_EXPIRED',
    });
    trainerBookingService.expireByPaymentTimeout.mockResolvedValue({
      id: 'booking-1',
      status: 'EXPIRED',
    });

    await consumer.handlePaymentFailed(payload, createContext());

    expect(trainerBookingService.expireByPaymentTimeout).toHaveBeenCalledWith(
      'booking-1',
      'pay-1',
      'SESSION_EXPIRED',
    );
    expect(trainerBookingService.failByPayment).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
  });

  it('acks refunded booking events after delegating to the service', async () => {
    const payload = createPayload({ status: 'REFUNDED' as any });
    trainerBookingService.cancelByRefund.mockResolvedValue({
      id: 'booking-1',
      status: 'CANCELLED',
    });

    await consumer.handlePaymentRefunded(payload, createContext());

    expect(trainerBookingService.cancelByRefund).toHaveBeenCalledWith(
      'booking-1',
      'pay-1',
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
  });

  it('acks permanent not-found errors and nacks transient errors', async () => {
    const payload = createPayload();
    trainerBookingService.confirmByPayment.mockRejectedValue(
      new NotFoundException('missing'),
    );

    await consumer.handlePaymentSuccess(payload, createContext());

    expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });
});
