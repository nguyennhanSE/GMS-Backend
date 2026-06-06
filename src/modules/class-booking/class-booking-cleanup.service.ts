import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'prisma/prisma.service';
import { AppCacheService } from '../../libs/cache/cache.service';
import { buildClassScheduleInvalidationTags } from '../class-schedule/class-schedule.cache';
import { buildTrainerAvailabilityTag } from '../trainer/trainer.cache';

const PENDING_BOOKING_TTL_MINUTES = 10;

@Injectable()
export class ClassBookingCleanupService {
  private readonly logger = new Logger(ClassBookingCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appCacheService: AppCacheService,
  ) {}

  /**
   * Runs every minute.
   * Deletes pending bookings that are older than PENDING_BOOKING_TTL_MINUTES
   * and have never had a checkout initiated (no linked Payment record).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupStalePendingBookings(): Promise<void> {
    const cutoff = new Date(
      Date.now() - PENDING_BOOKING_TTL_MINUTES * 60 * 1000,
    );

    // Find stale pending bookings with no linked payment
    const stale = await this.prisma.classBooking.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
        // No Payment row exists that targets this booking
        NOT: {
          id: {
            in: await this.getBookingIdsWithPayment(),
          },
        },
      },
      select: {
        id: true,
        classScheduleId: true,
      },
    });

    if (stale.length === 0) {
      return;
    }

    const ids = stale.map((b) => b.id);
    const scheduleIds = [
      ...new Set(stale.map((b) => b.classScheduleId).filter(Boolean) as string[]),
    ];

    await this.prisma.classBooking.deleteMany({
      where: { id: { in: ids } },
    });

    this.logger.log(
      `Cleaned up ${ids.length} stale pending booking(s) with no checkout`,
    );

    await this.invalidateScheduleCache(scheduleIds);
  }

  private async getBookingIdsWithPayment(): Promise<string[]> {
    const payments = await this.prisma.payment.findMany({
      where: { targetType: 'CLASS_BOOKING' },
      select: { targetId: true },
    });
    return payments.map((p) => p.targetId);
  }

  private async invalidateScheduleCache(scheduleIds: string[]): Promise<void> {
    if (scheduleIds.length === 0) return;

    const schedules = await this.prisma.classSchedule.findMany({
      where: { id: { in: scheduleIds } },
      select: { id: true, trainerId: true },
    });

    const tags = new Set<string>();
    for (const s of schedules) {
      for (const tag of buildClassScheduleInvalidationTags({
        scheduleId: s.id,
        trainerIds: [s.trainerId],
      })) {
        tags.add(tag);
      }
      tags.add(buildTrainerAvailabilityTag(s.trainerId));
    }

    await this.appCacheService.invalidateTags([...tags]);
  }
}
