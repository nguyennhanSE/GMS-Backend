import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MembershipPaymentConsumer } from './membership-payment.consumer';
import { MembershipsService } from './memberships.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PaymentEventPayload } from '../payment/dto/webhook-event.dto';
import { NOTIFICATION_EVENTS } from '../../common/events/notification.events';

describe('MembershipPaymentConsumer', () => {
  let consumer: MembershipPaymentConsumer;
  let membershipsService: jest.Mocked<any>;
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
        MembershipPaymentConsumer,
        { provide: MembershipsService, useValue: membershipsService },
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
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

    it('should skip non-membership events without touching ack state', async () => {
      const payload = createPayload({ targetType: 'CLASS_BOOKING' as any });

      await consumer.handlePaymentSuccess(payload, createContext());

      expect(membershipsService.activateByPayment).not.toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).not.toHaveBeenCalled();
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
      membershipsService.deactivateByPayment.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'member@test.local',
        firstName: 'Test',
        lastName: 'Member',
      });

      await consumer.handlePaymentFailed(payload, createContext());

      expect(membershipsService.deactivateByPayment).toHaveBeenCalledWith(
        'pay-1',
      );
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.PAYMENT_FAILED,
        expect.objectContaining({
          userId: 'user-1',
          userEmail: 'member@test.local',
          referenceId: 'membership-1',
        }),
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should skip non-membership events without touching ack state', async () => {
      const payload = createPayload({ targetType: 'CLASS_BOOKING' as any });

      await consumer.handlePaymentFailed(payload, createContext());

      expect(membershipsService.deactivateByPayment).not.toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should not emit a local notification event when membership state did not change', async () => {
      const payload = createPayload({ status: 'FAILED' as any });
      membershipsService.deactivateByPayment.mockResolvedValue(false);

      await consumer.handlePaymentFailed(payload, createContext());

      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
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
