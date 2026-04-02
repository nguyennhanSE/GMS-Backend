import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClassPerformanceQueryDto } from './dto/class-performance-query.dto';
import {
  ReportingInterval,
  RevenueAnalyticsQueryDto,
} from './dto/revenue-analytics-query.dto';
import { AppCacheService } from '../../libs/cache/cache.service';
import {
  buildClassPerformanceKey,
  buildReportingSummaryKey,
  buildRevenueAnalyticsKey,
  REPORTING_ANALYTICS_TTL_SECONDS,
  REPORTING_SUMMARY_TTL_SECONDS,
} from './reporting.cache';

type RevenueAnalyticsRow = {
  bucket: Date;
  total_revenue: string;
  membership_revenue: string;
  class_booking_revenue: string;
};

type TopBookedClassRow = {
  class_id: string;
  class_name: string;
  category: string;
  booking_count: string;
};

type RevenueByCategoryRow = {
  category: string;
  revenue: string;
};

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appCacheService: AppCacheService,
  ) {}

  async getSummaryKpis() {
    return this.appCacheService.remember(
      buildReportingSummaryKey(),
      async () => {
        const now = new Date();
        const startOfTodayUtc = this.startOfUtcDay(now);
        const startOfTomorrowUtc = this.addUtcDays(startOfTodayUtc, 1);

        const [
          revenueAggregate,
          activeMembers,
          totalTrainers,
          todaysClassBookings,
        ] = await Promise.all([
          this.prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: PaymentStatus.SUCCESS },
          }),
          this.prisma.user.count({
            where: {
              status: 'active',
              userMembership: {
                some: {
                  status: 'normal',
                  endDate: { gte: now },
                },
              },
            },
          }),
          this.prisma.user.count({
            where: {
              status: 'active',
              userRole: {
                some: {
                  role: {
                    name: 'TRAINER',
                  },
                },
              },
            },
          }),
          this.prisma.classBooking.count({
            where: {
              status: { in: ['pending', 'confirmed', 'attended'] },
              bookingStartDate: {
                gte: startOfTodayUtc,
                lt: startOfTomorrowUtc,
              },
            },
          }),
        ]);

        return {
          totalRevenue: Number(revenueAggregate._sum.amount ?? 0),
          activeMembers,
          totalTrainers,
          todaysClassBookings,
        };
      },
      {
        ttlSeconds: REPORTING_SUMMARY_TTL_SECONDS,
      },
    );
  }

  async getRevenueAnalytics(query: RevenueAnalyticsQueryDto) {
    return this.appCacheService.remember(
      buildRevenueAnalyticsKey(query),
      async () => {
        const interval = query.interval ?? 'month';
        const range = this.resolveRevenueRange(query, interval);
        const querySql = this.buildRevenueAnalyticsQuery(
          interval,
          range.startDate,
          range.endExclusive,
        );

        const rows = await this.prisma.$queryRaw<RevenueAnalyticsRow[]>(querySql);

        return {
          interval,
          startDate: this.toDateOnly(range.startDate),
          endDate: this.toDateOnly(range.endInclusive),
          buckets: rows.map((row) => ({
            bucket: row.bucket.toISOString(),
            totalRevenue: Number(row.total_revenue ?? '0'),
            membershipRevenue: Number(row.membership_revenue ?? '0'),
            classBookingRevenue: Number(row.class_booking_revenue ?? '0'),
          })),
        };
      },
      {
        ttlSeconds: REPORTING_ANALYTICS_TTL_SECONDS,
      },
    );
  }

  async getClassPerformance(query: ClassPerformanceQueryDto) {
    return this.appCacheService.remember(
      buildClassPerformanceKey(query),
      async () => {
        const range = this.resolveClassPerformanceRange(query);
        const topClassesSql = this.buildTopClassesQuery(range);
        const categoryRevenueSql = this.buildRevenueByCategoryQuery(range);

        const [topBookedClasses, revenueByCategory] = await Promise.all([
          this.prisma.$queryRaw<TopBookedClassRow[]>(topClassesSql),
          this.prisma.$queryRaw<RevenueByCategoryRow[]>(categoryRevenueSql),
        ]);

        return {
          startDate: range.startDate ? this.toDateOnly(range.startDate) : null,
          endDate: range.endInclusive ? this.toDateOnly(range.endInclusive) : null,
          topBookedClasses: topBookedClasses.map((row) => ({
            classId: row.class_id,
            className: row.class_name,
            category: row.category,
            bookingCount: Number(row.booking_count ?? '0'),
          })),
          revenueByCategory: revenueByCategory.map((row) => ({
            category: row.category,
            revenue: Number(row.revenue ?? '0'),
          })),
        };
      },
      {
        ttlSeconds: REPORTING_ANALYTICS_TTL_SECONDS,
      },
    );
  }

  private resolveRevenueRange(
    query: RevenueAnalyticsQueryDto,
    interval: ReportingInterval,
  ) {
    if (
      (query.startDate && !query.endDate) ||
      (!query.startDate && query.endDate)
    ) {
      throw new BadRequestException(
        'startDate and endDate must both be provided when filtering revenue analytics',
      );
    }

    if (!query.startDate && !query.endDate) {
      const today = new Date();
      const endInclusive = this.startOfUtcDay(today);

      if (interval === 'day') {
        const startDate = this.addUtcDays(endInclusive, -29);
        return {
          startDate,
          endInclusive,
          endExclusive: this.addUtcDays(endInclusive, 1),
        };
      }

      if (interval === 'week') {
        const currentWeekStart = this.startOfUtcWeek(today);
        const startDate = this.addUtcDays(currentWeekStart, -35);
        return {
          startDate,
          endInclusive,
          endExclusive: this.addUtcDays(endInclusive, 1),
        };
      }

      const endMonthStart = this.startOfUtcMonth(today);
      const startDate = new Date(
        Date.UTC(
          endMonthStart.getUTCFullYear(),
          endMonthStart.getUTCMonth() - 5,
          1,
        ),
      );

      return {
        startDate,
        endInclusive,
        endExclusive: this.addUtcDays(endInclusive, 1),
      };
    }

    const startDate = this.parseUtcDate(query.startDate!, 'startDate');
    const endInclusive = this.parseUtcDate(query.endDate!, 'endDate');

    if (startDate > endInclusive) {
      throw new BadRequestException(
        'startDate must be before or equal to endDate',
      );
    }

    return {
      startDate,
      endInclusive,
      endExclusive: this.addUtcDays(endInclusive, 1),
    };
  }

  private resolveClassPerformanceRange(query: ClassPerformanceQueryDto) {
    if (!query.startDate && !query.endDate) {
      return {
        startDate: null as Date | null,
        endInclusive: null as Date | null,
        endExclusive: null as Date | null,
      };
    }

    if (!query.startDate || !query.endDate) {
      throw new BadRequestException(
        'startDate and endDate must both be provided for class performance filters',
      );
    }

    const startDate = this.parseUtcDate(query.startDate, 'startDate');
    const endInclusive = this.parseUtcDate(query.endDate, 'endDate');

    if (startDate > endInclusive) {
      throw new BadRequestException(
        'startDate must be before or equal to endDate',
      );
    }

    return {
      startDate,
      endInclusive,
      endExclusive: this.addUtcDays(endInclusive, 1),
    };
  }

  private buildRevenueAnalyticsQuery(
    interval: ReportingInterval,
    startDate: Date,
    endExclusive: Date,
  ) {
    const intervalLiteral = Prisma.raw(`'${interval}'::text`);
    const stepLiteral = Prisma.raw(
      interval === 'day'
        ? "INTERVAL '1 day'"
        : interval === 'week'
          ? "INTERVAL '1 week'"
          : "INTERVAL '1 month'",
    );
    const seriesEnd = new Date(endExclusive.getTime() - 1);

    return Prisma.sql`
      WITH bucket_series AS (
        SELECT generate_series(
          date_trunc(${intervalLiteral}, CAST(${startDate} AS timestamp)),
          date_trunc(${intervalLiteral}, CAST(${seriesEnd} AS timestamp)),
          ${stepLiteral}
        ) AS bucket
      ),
      aggregated_revenue AS (
        SELECT
          date_trunc(${intervalLiteral}, p.paid_at) AS bucket,
          COALESCE(SUM(p.amount), 0)::text AS total_revenue,
          COALESCE(SUM(CASE WHEN p.target_type = 'MEMBERSHIP' THEN p.amount ELSE 0 END), 0)::text AS membership_revenue,
          COALESCE(SUM(CASE WHEN p.target_type = 'CLASS_BOOKING' THEN p.amount ELSE 0 END), 0)::text AS class_booking_revenue
        FROM payments p
        WHERE p.status = 'SUCCESS'
          AND p.paid_at IS NOT NULL
          AND p.paid_at >= ${startDate}
          AND p.paid_at < ${endExclusive}
        GROUP BY 1
      )
      SELECT
        bs.bucket AS bucket,
        COALESCE(ar.total_revenue, '0') AS total_revenue,
        COALESCE(ar.membership_revenue, '0') AS membership_revenue,
        COALESCE(ar.class_booking_revenue, '0') AS class_booking_revenue
      FROM bucket_series bs
      LEFT JOIN aggregated_revenue ar
        ON ar.bucket = bs.bucket
      ORDER BY bs.bucket ASC
    `;
  }

  private buildTopClassesQuery(range: {
    startDate: Date | null;
    endExclusive: Date | null;
  }) {
    const dateFilter =
      range.startDate && range.endExclusive
        ? Prisma.sql`
            AND cb.booking_start_date >= ${range.startDate}
            AND cb.booking_start_date < ${range.endExclusive}
          `
        : Prisma.empty;

    return Prisma.sql`
      SELECT
        gc.id AS class_id,
        gc.class_name AS class_name,
        gc.category AS category,
        COUNT(cb.id)::text AS booking_count
      FROM class_bookings cb
      INNER JOIN class_schedules cs
        ON cs.id = cb.class_schedule_id
      INNER JOIN gym_classes gc
        ON gc.id = cs.class_id
      WHERE cb.status IN ('pending', 'confirmed', 'attended')
      ${dateFilter}
      GROUP BY gc.id, gc.class_name, gc.category
      ORDER BY COUNT(cb.id) DESC, gc.class_name ASC
      LIMIT 5
    `;
  }

  private buildRevenueByCategoryQuery(range: {
    startDate: Date | null;
    endExclusive: Date | null;
  }) {
    const paidAtFilter =
      range.startDate && range.endExclusive
        ? Prisma.sql`
            AND p.paid_at >= ${range.startDate}
            AND p.paid_at < ${range.endExclusive}
          `
        : Prisma.empty;

    return Prisma.sql`
      SELECT
        gc.category AS category,
        COALESCE(SUM(p.amount), 0)::text AS revenue
      FROM payments p
      INNER JOIN class_bookings cb
        ON cb.id = p.target_id
      INNER JOIN class_schedules cs
        ON cs.id = cb.class_schedule_id
      INNER JOIN gym_classes gc
        ON gc.id = cs.class_id
      WHERE p.status = 'SUCCESS'
        AND p.target_type = 'CLASS_BOOKING'
        AND p.paid_at IS NOT NULL
      ${paidAtFilter}
      GROUP BY gc.category
      ORDER BY SUM(p.amount) DESC, gc.category ASC
    `;
  }

  private parseUtcDate(value: string, fieldName: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `${fieldName} must be a valid UTC date string`,
      );
    }

    return parsed;
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private startOfUtcWeek(date: Date): Date {
    const utcDay = date.getUTCDay();
    const offset = utcDay === 0 ? -6 : 1 - utcDay;
    const start = this.startOfUtcDay(date);
    start.setUTCDate(start.getUTCDate() + offset);
    return start;
  }

  private startOfUtcMonth(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  private addUtcDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private toDateOnly(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
