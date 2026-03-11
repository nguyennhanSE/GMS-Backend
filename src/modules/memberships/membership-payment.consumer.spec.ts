import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MembershipPaymentConsumer } from './membership-payment.consumer';
import { MembershipsService } from './memberships.service';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';

describe('MembershipPaymentConsumer', () => {
  let consumer: MembershipPaymentConsumer;
  let membershipsService: jest.Mocked<any>;
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
    targetType: 'MEMBERSHIP',
    targetId: 'membership-1',
    status: 'SUCCESS',
    amount: 480000,
    currency: 'VND',
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    membershipsService = {
      activateByPayment: jest.fn(),
      deactivateByPayment: jest.fn(),
    };

    mockChannel = { ack: jest.fn(), nack: jest.fn() };
    mockMessage = { fields: {}, properties: {}, content: Buffer.from('') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipPaymentConsumer,
        { provide: MembershipsService, useValue: membershipsService },
      ],
    }).compile();

    consumer = module.get<MembershipPaymentConsumer>(
      MembershipPaymentConsumer,
    );
  });

  it('should be defined', () => {
    expect(consumer).toBeDefined();
  });

  describe('handlePaymentSuccess', () => {
    it('should activate membership and ack on success', async () => {
      const payload = createPayload();
      membershipsService.activateByPayment.mockResolvedValue({});

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(membershipsService.activateByPayment).toHaveBeenCalledWith(
        'pay-1',
        'user-1',
        'membership-1',
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should skip non-membership events and ack', async () => {
      const payload = createPayload({ targetType: 'CLASS_BOOKING' as any });

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(membershipsService.activateByPayment).not.toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should ack on NotFoundException (permanent failure)', async () => {
      const payload = createPayload();
      membershipsService.activateByPayment.mockRejectedValue(
        new NotFoundException('Membership not found'),
      );

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should nack to DLQ on transient error', async () => {
      const payload = createPayload();
      membershipsService.activateByPayment.mockRejectedValue(
        new Error('Connection refused'),
      );

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, false);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentFailed', () => {
    it('should deactivate membership and ack on success', async () => {
      const payload = createPayload({ status: 'FAILED' as any });
      membershipsService.deactivateByPayment.mockResolvedValue(undefined);

      await consumer.handlePaymentFailed(payload, createContext());

      expect(membershipsService.deactivateByPayment).toHaveBeenCalledWith(
        'pay-1',
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should skip non-membership events and ack', async () => {
      const payload = createPayload({ targetType: 'CLASS_BOOKING' as any });

      await consumer.handlePaymentFailed(payload, createContext());

      expect(membershipsService.deactivateByPayment).not.toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });
  });

  describe('handlePaymentRefunded', () => {
    it('should deactivate membership and ack on success', async () => {
      const payload = createPayload({ status: 'REFUNDED' as any });
      membershipsService.deactivateByPayment.mockResolvedValue(undefined);

      await consumer.handlePaymentRefunded(payload, createContext());

      expect(membershipsService.deactivateByPayment).toHaveBeenCalledWith(
        'pay-1',
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should nack to DLQ on transient error (refund path)', async () => {
      const payload = createPayload({ status: 'REFUNDED' as any });
      membershipsService.deactivateByPayment.mockRejectedValue(
        new Error('DB timeout'),
      );

      await consumer.handlePaymentRefunded(payload, createContext());

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, false);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });
  });
});
