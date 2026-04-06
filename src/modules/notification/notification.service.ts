import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  NOTIFICATION_EVENTS,
} from '../../common/events/notification.events';
import type { NotificationEventPayload } from '../../common/events/notification.events';

interface NotificationListOptions {
  page: number;
  limit: number;
  unreadOnly: boolean;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
  }

  async getNotifications(userId: string, options: NotificationListOptions) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(options.unreadOnly ? { isRead: false } : {}),
    };

    const skip = (options.page - 1) * options.limit;

    const [docs, totalDocs] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: options.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const totalPages = Math.ceil(totalDocs / options.limit) || 1;

    return {
      docs,
      totalDocs,
      totalPages,
      currentPage: options.page,
      nextPage: options.page < totalPages ? options.page + 1 : null,
      previousPage: options.page > 1 ? options.page - 1 : null,
      limit: options.limit,
      hasNext: options.page < totalPages,
      hasPrev: options.page > 1,
    };
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    if (notification.isRead) {
      return notification;
    }

    return this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return {
      updatedCount: result.count,
    };
  }

  @OnEvent(NOTIFICATION_EVENTS.PAYMENT_FAILED)
  async handlePaymentFailed(payload: NotificationEventPayload) {
    await this.createNotification(payload);
  }

  @OnEvent(NOTIFICATION_EVENTS.CLASS_CANCELLED)
  async handleClassCancelled(payload: NotificationEventPayload) {
    await this.createNotification(payload);
  }

  @OnEvent(NOTIFICATION_EVENTS.MEMBERSHIP_EXPIRING)
  async handleMembershipExpiring(payload: NotificationEventPayload) {
    await this.createNotification(payload);
  }

  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_CREATED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_ACCEPTED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_REJECTED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_CONFIRMED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_CANCELLED)
  @OnEvent(NOTIFICATION_EVENTS.TRAINER_BOOKING_REMINDER)
  async handleTrainerBookingEvent(payload: NotificationEventPayload) {
    await this.createNotification(payload);
  }

  private async createNotification(payload: NotificationEventPayload) {
    await this.prisma.notification.create({
      data: {
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        referenceId: payload.referenceId,
        metadata: payload.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    this.logger.log(`Notification created for user ${payload.userId}`, {
      type: payload.type,
      referenceId: payload.referenceId,
    });
  }
}
