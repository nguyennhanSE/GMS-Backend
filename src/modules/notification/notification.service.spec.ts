import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from './notification.service';
import {
  NOTIFICATION_EVENTS,
  type NotificationEventPayload,
} from '../../common/events/notification.events';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: jest.Mocked<any>;

  const createPayload = (
    overrides?: Partial<NotificationEventPayload>,
  ): NotificationEventPayload => ({
    userId: 'user-1',
    userEmail: 'member@test.local',
    userName: 'Test Member',
    type: NotificationType.PAYMENT,
    title: 'Payment failed',
    message: 'Please update your card.',
    referenceId: 'payment-1',
    metadata: {
      eventKey: NOTIFICATION_EVENTS.PAYMENT_FAILED,
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      notification: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUnreadCount', () => {
    it('counts unread notifications for the current user', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount('user-1');

      expect(result).toBe(3);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
      });
    });
  });

  describe('getNotifications', () => {
    it('returns paginated notifications ordered by newest first', async () => {
      const docs = [
        { id: 'noti-2', createdAt: new Date('2026-03-19T10:00:00Z') },
        { id: 'noti-1', createdAt: new Date('2026-03-18T10:00:00Z') },
      ];
      prisma.notification.findMany.mockResolvedValue(docs);
      prisma.notification.count.mockResolvedValue(4);

      const result = await service.getNotifications('user-1', {
        page: 2,
        limit: 2,
        unreadOnly: true,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        orderBy: { createdAt: 'desc' },
        skip: 2,
        take: 2,
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
      });
      expect(result).toEqual({
        docs,
        totalDocs: 4,
        totalPages: 2,
        currentPage: 2,
        nextPage: null,
        previousPage: 1,
        limit: 2,
        hasNext: false,
        hasPrev: true,
      });
    });

    it('keeps totalPages at 1 when there are no notifications', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getNotifications('user-1', {
        page: 1,
        limit: 10,
        unreadOnly: false,
      });

      expect(result.totalPages).toBe(1);
      expect(result.docs).toEqual([]);
    });
  });

  describe('markAsRead', () => {
    it('marks an unread notification as read', async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: 'noti-1',
        userId: 'user-1',
        isRead: false,
      });
      prisma.notification.update.mockResolvedValue({
        id: 'noti-1',
        userId: 'user-1',
        isRead: true,
        readAt: new Date('2026-03-19T10:00:00Z'),
      });

      const result = await service.markAsRead('noti-1', 'user-1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'noti-1' },
        data: {
          isRead: true,
          readAt: expect.any(Date),
        },
      });
      expect(result.isRead).toBe(true);
    });

    it('returns the notification unchanged when already read', async () => {
      const existing = {
        id: 'noti-1',
        userId: 'user-1',
        isRead: true,
      };
      prisma.notification.findFirst.mockResolvedValue(existing);

      const result = await service.markAsRead('noti-1', 'user-1');

      expect(result).toBe(existing);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('throws when the notification does not belong to the user', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead('noti-1', 'user-1')).rejects.toThrow(
        new NotFoundException('Notification noti-1 not found'),
      );
    });
  });

  describe('markAllAsRead', () => {
    it('marks all unread notifications as read and returns the updated count', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        data: {
          isRead: true,
          readAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ updatedCount: 5 });
    });
  });

  describe('event listeners', () => {
    it('persists a payment-failed notification from the local event payload', async () => {
      const payload = createPayload();

      await service.handlePaymentFailed(payload);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: NotificationType.PAYMENT,
          title: 'Payment failed',
          message: 'Please update your card.',
          referenceId: 'payment-1',
          metadata: {
            eventKey: NOTIFICATION_EVENTS.PAYMENT_FAILED,
          },
        },
      });
    });

    it('persists a class-cancelled notification', async () => {
      const payload = createPayload({
        type: NotificationType.BOOKING,
        title: 'Class cancelled',
        message: 'Yoga class was cancelled.',
        referenceId: 'booking-1',
        metadata: {
          eventKey: NOTIFICATION_EVENTS.CLASS_CANCELLED,
          bookingId: 'booking-1',
        },
      });

      await service.handleClassCancelled(payload);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.BOOKING,
            title: 'Class cancelled',
            referenceId: 'booking-1',
          }),
        }),
      );
    });

    it('persists a membership-expiring notification', async () => {
      const payload = createPayload({
        type: NotificationType.MEMBERSHIP,
        title: 'Membership expiring soon',
        message: 'Renew today.',
        referenceId: 'membership-1',
        metadata: {
          eventKey: NOTIFICATION_EVENTS.MEMBERSHIP_EXPIRING,
          daysRemaining: 3,
        },
      });

      await service.handleMembershipExpiring(payload);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.MEMBERSHIP,
            title: 'Membership expiring soon',
            referenceId: 'membership-1',
          }),
        }),
      );
    });

    it('persists trainer-booking lifecycle notifications through the shared handler', async () => {
      const payload = createPayload({
        type: NotificationType.BOOKING,
        title: 'Trainer booking accepted',
        message: 'Complete payment to confirm the session.',
        referenceId: 'trainer-booking-1',
        metadata: {
          eventKey: NOTIFICATION_EVENTS.TRAINER_BOOKING_ACCEPTED,
          bookingId: 'trainer-booking-1',
        },
      });

      await service.handleTrainerBookingEvent(payload);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.BOOKING,
            title: 'Trainer booking accepted',
            referenceId: 'trainer-booking-1',
          }),
        }),
      );
    });
  });
});
