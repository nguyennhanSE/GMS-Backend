import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  NOTIFICATION_EVENTS,
  NotificationEventPayload,
} from '../../../common/events/notification.events';

@Injectable()
export class MembershipExpiryNotificationCronService {
  private readonly logger = new Logger(
    MembershipExpiryNotificationCronService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleMembershipExpiryNotifications() {
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 3);

    const targetDateStart = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
    );
    const targetDateEnd = new Date(targetDateStart);
    targetDateEnd.setDate(targetDateEnd.getDate() + 1);

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const expiringMemberships = await this.prisma.userMembership.findMany({
      where: {
        status: 'normal',
        endDate: {
          gte: targetDateStart,
          lt: targetDateEnd,
        },
      },
      include: {
        user: true,
        membership: true,
      },
    });

    const emitTasks = expiringMemberships.map(async (membership) => {
      if (!membership.user) {
        return;
      }

      const existing = await this.prisma.notification.count({
        where: {
          userId: membership.userId,
          type: NotificationType.MEMBERSHIP,
          referenceId: membership.id,
          createdAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
      });

      if (existing > 0) {
        return;
      }

      const payload: NotificationEventPayload = {
        userId: membership.user.id,
        userEmail: membership.user.email,
        userName: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
        type: NotificationType.MEMBERSHIP,
        title: 'Membership expiring soon',
        message: `Your ${membership.membershipName} membership will expire in 3 days. Renew it to keep your access active.`,
        referenceId: membership.id,
        metadata: {
          eventKey: NOTIFICATION_EVENTS.MEMBERSHIP_EXPIRING,
          membershipId: membership.membershipId,
          userMembershipId: membership.id,
          endDate: membership.endDate.toISOString(),
          daysRemaining: 3,
        },
      };

      await this.eventEmitter.emitAsync(
        NOTIFICATION_EVENTS.MEMBERSHIP_EXPIRING,
        payload,
      );
    });

    const results = await Promise.allSettled(emitTasks);
    const failedCount = results.filter(
      (result) => result.status === 'rejected',
    ).length;

    if (failedCount > 0) {
      this.logger.error(
        `Membership expiry notification cron completed with ${failedCount} failed emits`,
      );
      return;
    }

    this.logger.log(
      `Membership expiry notification cron processed ${expiringMemberships.length} memberships`,
    );
  }
}
