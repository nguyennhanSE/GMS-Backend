import { ReportingService } from './reporting.service';
import { AppCacheService } from '../../libs/cache/cache.service';

describe('ReportingService', () => {
  let service: ReportingService;
  let prisma: {
    payment: { aggregate: jest.Mock };
    user: { count: jest.Mock };
    classBooking: { count: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let appCacheService: {
    remember: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      payment: {
        aggregate: jest.fn(),
      },
      user: {
        count: jest.fn(),
      },
      classBooking: {
        count: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    appCacheService = {
      remember: jest.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
    };

    service = new ReportingService(
      prisma as any,
      appCacheService as unknown as AppCacheService,
    );
  });

  it('caches summary KPIs with the short reporting TTL', async () => {
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1250000 } });
    prisma.user.count
      .mockResolvedValueOnce(42)
      .mockResolvedValueOnce(7);
    prisma.classBooking.count.mockResolvedValue(18);

    await expect(service.getSummaryKpis()).resolves.toEqual({
      totalRevenue: 1250000,
      activeMembers: 42,
      totalTrainers: 7,
      todaysClassBookings: 18,
    });
    expect(appCacheService.remember).toHaveBeenCalledWith(
      'gms:reporting:summary-kpis',
      expect.any(Function),
      expect.objectContaining({
        ttlSeconds: 60,
      }),
    );
  });

  it('uses a normalized revenue analytics cache key for default-equivalent queries', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        bucket: new Date('2026-03-01T00:00:00.000Z'),
        total_revenue: '1000',
        membership_revenue: '600',
        class_booking_revenue: '400',
      },
    ]);

    await service.getRevenueAnalytics({
      interval: 'month',
      startDate: '',
      endDate: '',
    });

    expect(appCacheService.remember).toHaveBeenCalledWith(
      expect.stringMatching(/^gms:reporting:revenue:/),
      expect.any(Function),
      expect.objectContaining({
        ttlSeconds: 300,
      }),
    );

    const firstKey = appCacheService.remember.mock.calls[0][0];
    appCacheService.remember.mockClear();

    await service.getRevenueAnalytics({});

    expect(appCacheService.remember.mock.calls[0][0]).toBe(firstKey);
  });

  it('caches class performance queries by normalized date range', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          class_id: 'class-1',
          class_name: 'Morning Yoga',
          category: 'Yoga',
          booking_count: '12',
        },
      ])
      .mockResolvedValueOnce([
        {
          category: 'Yoga',
          revenue: '2400',
        },
      ]);

    await expect(
      service.getClassPerformance({
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      }),
    ).resolves.toEqual({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      topBookedClasses: [
        {
          classId: 'class-1',
          className: 'Morning Yoga',
          category: 'Yoga',
          bookingCount: 12,
        },
      ],
      revenueByCategory: [
        {
          category: 'Yoga',
          revenue: 2400,
        },
      ],
    });

    expect(appCacheService.remember).toHaveBeenCalledWith(
      expect.stringMatching(/^gms:reporting:class-performance:/),
      expect.any(Function),
      expect.objectContaining({
        ttlSeconds: 300,
      }),
    );
  });
});
