import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as supertest from 'supertest';
import { AppCacheService } from '../../libs/cache/cache.service';
import { APP_CACHE_STATE } from '../../libs/cache/cache.constants';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { PrismaService } from '../../../prisma/prisma.service';

type CacheRecord = {
  value: unknown;
  ttl?: number;
};

function createMemoryCache() {
  const store = new Map<string, CacheRecord>();

  return {
    get: jest.fn((key: string) => store.get(key)?.value),
    set: jest.fn((key: string, value: unknown, ttl?: number) => {
      store.set(key, { value, ttl });
    }),
    mdel: jest.fn((keys: string[]) => {
      for (const key of keys) {
        store.delete(key);
      }
    }),
    disconnect: jest.fn(() => undefined),
  };
}

describe('ReportingController Redis cache mock API', () => {
  let app: INestApplication;
  let prisma: {
    payment: { aggregate: jest.Mock };
    user: { count: jest.Mock };
    classBooking: { count: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let cache: ReturnType<typeof createMemoryCache>;

  async function createApp(): Promise<void> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ReportingController],
      providers: [
        ReportingService,
        AppCacheService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: APP_CACHE_STATE,
          useValue: {
            cache: cache,
            redisStore: null,
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }

  beforeEach(async () => {
    prisma = {
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1250000 } }),
      },
      user: {
        count: jest
          .fn()
          .mockResolvedValueOnce(42)
          .mockResolvedValueOnce(7),
      },
      classBooking: {
        count: jest.fn().mockResolvedValue(18),
      },
      $queryRaw: jest.fn(),
    };

    cache = createMemoryCache();
    await createApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('serves the second identical request from cache instead of hitting prisma again', async () => {
    const firstResponse = await supertest
      .default(app.getHttpServer())
      .get('/reporting/summary-kpis')
      .expect(200);

    expect(firstResponse.body.data).toEqual({
      totalRevenue: 1250000,
      activeMembers: 42,
      totalTrainers: 7,
      todaysClassBookings: 18,
    });
    expect(prisma.payment.aggregate).toHaveBeenCalledTimes(1);
    expect(prisma.user.count).toHaveBeenCalledTimes(2);
    expect(prisma.classBooking.count).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'gms:reporting:summary-kpis',
      {
        totalRevenue: 1250000,
        activeMembers: 42,
        totalTrainers: 7,
        todaysClassBookings: 18,
      },
      60000,
    );

    prisma.payment.aggregate.mockClear();
    prisma.user.count.mockClear();
    prisma.classBooking.count.mockClear();

    const secondResponse = await supertest
      .default(app.getHttpServer())
      .get('/reporting/summary-kpis')
      .expect(200);

    expect(secondResponse.body.data).toEqual(firstResponse.body.data);
    expect(prisma.payment.aggregate).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.classBooking.count).not.toHaveBeenCalled();
  });

  it('returns 200 and falls back to prisma when cache reads fail', async () => {
    cache.get.mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await supertest
      .default(app.getHttpServer())
      .get('/reporting/summary-kpis')
      .expect(200);

    expect(response.body.data).toEqual({
      totalRevenue: 1250000,
      activeMembers: 42,
      totalTrainers: 7,
      todaysClassBookings: 18,
    });
    expect(prisma.payment.aggregate).toHaveBeenCalledTimes(1);
    expect(prisma.user.count).toHaveBeenCalledTimes(2);
    expect(prisma.classBooking.count).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'gms:reporting:summary-kpis',
      {
        totalRevenue: 1250000,
        activeMembers: 42,
        totalTrainers: 7,
        todaysClassBookings: 18,
      },
      60000,
    );
  });
});
