import { expect, test, type APIRequestContext } from '@playwright/test';
import { PaymentStatus, PaymentTargetType } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  API_BASE_URL,
  createApiContext,
  loginAs,
  startTemporaryApiServer,
  type TemporaryApiServer,
} from './api-helpers';
import { isDeployedTarget } from './target-mode';

type TestUserKey =
  | 'admin'
  | 'activeTrainer'
  | 'inactiveTrainer'
  | 'activeMember'
  | 'bookingMemberA'
  | 'bookingMemberB'
  | 'bookingMemberC'
  | 'expiredMember';

type SummarySnapshot = {
  totalRevenue: number;
  activeMembers: number;
  totalTrainers: number;
  todaysClassBookings: number;
};

const prisma = new PrismaService();
const TEST_PASSWORD = 'PlaywrightReporting@123';
const suitePrefix = 'playwright-reporting-module';
const suiteKey = `${suitePrefix}-${Date.now()}`;
const reportRangeStart = '2035-01-01';
const reportRangeEnd = '2035-03-31';
const userEmails = {
  admin: `${suiteKey}-admin@test.local`,
  activeTrainer: `${suiteKey}-trainer-active@test.local`,
  inactiveTrainer: `${suiteKey}-trainer-inactive@test.local`,
  activeMember: `${suiteKey}-member-active@test.local`,
  bookingMemberA: `${suiteKey}-member-a@test.local`,
  bookingMemberB: `${suiteKey}-member-b@test.local`,
  bookingMemberC: `${suiteKey}-member-c@test.local`,
  expiredMember: `${suiteKey}-member-expired@test.local`,
} as const satisfies Record<TestUserKey, string>;
const userIds = {} as Record<TestUserKey, string>;

const membershipName = `${suiteKey}-membership`;
const classNames = {
  yoga: `${suiteKey}-Alpha Yoga`,
  boxing: `${suiteKey}-Bravo Boxing`,
  cycle: `${suiteKey}-Charlie Cycle`,
  dance: `${suiteKey}-Delta Dance`,
  hiit: `${suiteKey}-Echo HIIT`,
  zeta: `${suiteKey}-Zulu Stretch`,
} as const;

test.describe('Reporting Module Playwright API E2E', () => {
  let temporaryServer: TemporaryApiServer;
  let anonymousApi: APIRequestContext;
  let adminApi: APIRequestContext;
  let memberApi: APIRequestContext;
  let baselineSummary: SummarySnapshot;
  let activeBaseUrl: string;

  test.beforeAll(async () => {
    await prisma.$connect();
    await cleanupSuiteState();
    baselineSummary = await getSummaryBaseline();
    await seedReportingFixtures();

    if (isDeployedTarget()) {
      activeBaseUrl = API_BASE_URL;
      anonymousApi = await createApiContext(undefined, activeBaseUrl);
    } else {
      temporaryServer = await startTemporaryApiServer({
        REDIS_ENABLED: '0',
      });
      activeBaseUrl = temporaryServer.baseURL;
      anonymousApi = await createApiContext(undefined, activeBaseUrl);
    }

    adminApi = await createAuthenticatedContext(userEmails.admin);
    memberApi = await createAuthenticatedContext(userEmails.activeMember);
  });

  test.afterAll(async () => {
    await Promise.all([
      anonymousApi?.dispose(),
      adminApi?.dispose(),
      memberApi?.dispose(),
    ]);
    await temporaryServer?.stop();
    await cleanupSuiteState();
    await prisma.$disconnect();
  });

  async function createAuthenticatedContext(
    email: string,
  ): Promise<APIRequestContext> {
    const login = await loginAs(anonymousApi, email, TEST_PASSWORD);
    return createApiContext(login.accessToken, activeBaseUrl);
  }

  async function ensureRole(name: string, description: string) {
    return prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description },
    });
  }

  async function createUser(
    key: TestUserKey,
    roleIds: string[],
    status: string,
    firstName: string,
    lastName: string,
  ) {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const created = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: userEmails[key],
        password: passwordHash,
        status,
        userRole: {
          create: roleIds.map((roleId) => ({ roleId })),
        },
      },
    });

    userIds[key] = created.id;
  }

  async function seedReportingFixtures() {
    const [adminRole, trainerRole, memberRole] = await Promise.all([
      ensureRole('ADMIN', 'Admin role'),
      ensureRole('TRAINER', 'Trainer role'),
      ensureRole('MEMBER', 'Member role'),
    ]);

    await createUser('admin', [adminRole.id], 'active', 'Reporting', 'Admin');
    await createUser(
      'activeTrainer',
      [trainerRole.id],
      'active',
      'Reporting',
      'Trainer',
    );
    await createUser(
      'inactiveTrainer',
      [trainerRole.id],
      'inactive',
      'Reporting',
      'InactiveTrainer',
    );
    await createUser(
      'activeMember',
      [memberRole.id],
      'active',
      'Reporting',
      'MemberActive',
    );
    await createUser(
      'bookingMemberA',
      [memberRole.id],
      'active',
      'Reporting',
      'MemberA',
    );
    await createUser(
      'bookingMemberB',
      [memberRole.id],
      'active',
      'Reporting',
      'MemberB',
    );
    await createUser(
      'bookingMemberC',
      [memberRole.id],
      'active',
      'Reporting',
      'MemberC',
    );
    await createUser(
      'expiredMember',
      [memberRole.id],
      'active',
      'Reporting',
      'MemberExpired',
    );

    const membership = await prisma.membership.create({
      data: {
        name: membershipName,
        description: 'Reporting Playwright membership fixture',
        minPrice: 100,
        purchasePrice: 100,
        level: 'BASIC',
      },
    });

    await prisma.userMembership.createMany({
      data: [
        {
          userId: userIds.activeMember,
          membershipId: membership.id,
          membershipName,
          membershipDescription: 'Active reporting membership',
          level: 'BASIC',
          status: 'normal',
          startDate: toUtcDate('2034-12-01'),
          endDate: toUtcDate('2040-01-01'),
        },
        {
          userId: userIds.expiredMember,
          membershipId: membership.id,
          membershipName,
          membershipDescription: 'Expired reporting membership',
          level: 'BASIC',
          status: 'expired',
          startDate: toUtcDate('2034-01-01'),
          endDate: toUtcDate('2034-12-31'),
        },
      ],
    });

    const createdClasses = await Promise.all(
      Object.values(classNames).map((className) =>
        prisma.gymClass.create({
          data: {
            className,
            description: `${className} fixture`,
            difficultyLevel: 'Beginner',
            category: resolveCategory(className),
            isActive: true,
          },
        }),
      ),
    );

    const classByName = new Map(
      createdClasses.map((gymClass) => [gymClass.className, gymClass]),
    );

    const schedules = await Promise.all([
      createSchedule(classByName.get(classNames.yoga)!.id, 'MON', 8),
      createSchedule(classByName.get(classNames.boxing)!.id, 'TUE', 10),
      createSchedule(classByName.get(classNames.cycle)!.id, 'WED', 12),
      createSchedule(classByName.get(classNames.dance)!.id, 'THU', 14),
      createSchedule(classByName.get(classNames.hiit)!.id, 'FRI', 16),
      createSchedule(classByName.get(classNames.zeta)!.id, 'SAT', 18),
    ]);

    const scheduleByClassName = new Map<string, string>([
      [classNames.yoga, schedules[0].id],
      [classNames.boxing, schedules[1].id],
      [classNames.cycle, schedules[2].id],
      [classNames.dance, schedules[3].id],
      [classNames.hiit, schedules[4].id],
      [classNames.zeta, schedules[5].id],
    ]);

    const today = startOfUtcDay(new Date());
    const bookings = await Promise.all([
      createBooking(
        userIds.activeMember,
        scheduleByClassName.get(classNames.yoga)!,
        today,
        'confirmed',
      ),
      createBooking(
        userIds.bookingMemberA,
        scheduleByClassName.get(classNames.yoga)!,
        today,
        'cancelled',
      ),
      createBooking(
        userIds.activeMember,
        scheduleByClassName.get(classNames.yoga)!,
        toUtcDate('2035-01-15'),
        'attended',
      ),
      createBooking(
        userIds.bookingMemberB,
        scheduleByClassName.get(classNames.yoga)!,
        toUtcDate('2035-02-20'),
        'pending',
      ),
      createBooking(
        userIds.bookingMemberC,
        scheduleByClassName.get(classNames.yoga)!,
        toUtcDate('2035-03-05'),
        'confirmed',
      ),
      createBooking(
        userIds.expiredMember,
        scheduleByClassName.get(classNames.boxing)!,
        toUtcDate('2035-02-10'),
        'confirmed',
      ),
      createBooking(
        userIds.bookingMemberA,
        scheduleByClassName.get(classNames.cycle)!,
        toUtcDate('2034-11-04'),
        'confirmed',
      ),
      createBooking(
        userIds.bookingMemberB,
        scheduleByClassName.get(classNames.dance)!,
        toUtcDate('2034-11-05'),
        'confirmed',
      ),
      createBooking(
        userIds.bookingMemberC,
        scheduleByClassName.get(classNames.hiit)!,
        toUtcDate('2034-11-06'),
        'confirmed',
      ),
      createBooking(
        userIds.activeMember,
        scheduleByClassName.get(classNames.zeta)!,
        toUtcDate('2034-11-07'),
        'confirmed',
      ),
    ]);

    await prisma.payment.createMany({
      data: [
        {
          userId: userIds.activeMember,
          targetType: PaymentTargetType.MEMBERSHIP,
          targetId: membership.id,
          amount: 100,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date('2035-01-10T08:00:00.000Z'),
        },
        {
          userId: userIds.activeMember,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: bookings[2].id,
          amount: 50,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date('2035-01-15T12:00:00.000Z'),
        },
        {
          userId: userIds.expiredMember,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: bookings[5].id,
          amount: 70,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date('2035-02-10T12:00:00.000Z'),
        },
        {
          userId: userIds.activeMember,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: bookings[0].id,
          amount: 999,
          status: PaymentStatus.FAILED,
        },
        {
          userId: userIds.bookingMemberB,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: bookings[3].id,
          amount: 888,
          status: PaymentStatus.PENDING,
        },
        {
          userId: userIds.bookingMemberA,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: bookings[1].id,
          amount: 777,
          status: PaymentStatus.REFUNDED,
          paidAt: new Date('2035-03-20T09:00:00.000Z'),
        },
      ],
    });
  }

  async function createSchedule(
    classId: string,
    dayOfWeek: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT',
    startHour: number,
  ) {
    return prisma.classSchedule.create({
      data: {
        classId,
        trainerId: userIds.activeTrainer,
        dayOfWeek,
        startTime: new Date(`1970-01-01T${String(startHour).padStart(2, '0')}:00:00.000Z`),
        endTime: new Date(`1970-01-01T${String(startHour + 1).padStart(2, '0')}:00:00.000Z`),
        capacity: 20,
        price: 50,
        location: `${suiteKey}-${dayOfWeek}`,
        isActive: true,
      },
    });
  }

  async function createBooking(
    userId: string,
    classScheduleId: string,
    bookingDate: Date,
    status: string,
  ) {
    return prisma.classBooking.create({
      data: {
        userId,
        classScheduleId,
        bookingStartDate: bookingDate,
        bookingEndDate: bookingDate,
        status,
      },
    });
  }

  async function getSummaryBaseline(): Promise<SummarySnapshot> {
    const now = new Date();
    const startOfToday = startOfUtcDay(now);
    const startOfTomorrow = addUtcDays(startOfToday, 1);

    const [revenueAggregate, activeMembers, totalTrainers, todaysClassBookings] =
      await Promise.all([
        prisma.payment.aggregate({
          _sum: { amount: true },
          where: { status: PaymentStatus.SUCCESS },
        }),
        prisma.user.count({
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
        prisma.user.count({
          where: {
            status: 'active',
            userRole: {
              some: {
                role: { name: 'TRAINER' },
              },
            },
          },
        }),
        prisma.classBooking.count({
          where: {
            status: { in: ['pending', 'confirmed', 'attended'] },
            bookingStartDate: {
              gte: startOfToday,
              lt: startOfTomorrow,
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
  }

  async function cleanupSuiteState() {
    const users = await prisma.user.findMany({
      where: {
        email: {
          startsWith: suitePrefix,
        },
      },
      select: { id: true },
    });
    const userIdList = users.map((user) => user.id);

    const memberships = await prisma.membership.findMany({
      where: {
        name: {
          startsWith: suitePrefix,
        },
      },
      select: { id: true },
    });
    const membershipIds = memberships.map((membership) => membership.id);

    const schedules = await prisma.classSchedule.findMany({
      where: {
        gymClass: {
          className: {
            startsWith: suitePrefix,
          },
        },
      },
      select: { id: true },
    });
    const scheduleIds = schedules.map((schedule) => schedule.id);

    const bookings = await prisma.classBooking.findMany({
      where: {
        OR: [
          userIdList.length > 0 ? { userId: { in: userIdList } } : undefined,
          scheduleIds.length > 0
            ? { classScheduleId: { in: scheduleIds } }
            : undefined,
        ].filter(Boolean) as Array<Record<string, unknown>>,
      },
      select: { id: true },
    });
    const bookingIds = bookings.map((booking) => booking.id);

    const paymentFilters = [
      userIdList.length > 0 ? { userId: { in: userIdList } } : undefined,
      bookingIds.length > 0
        ? {
            targetType: PaymentTargetType.CLASS_BOOKING,
            targetId: { in: bookingIds },
          }
        : undefined,
      membershipIds.length > 0
        ? {
            targetType: PaymentTargetType.MEMBERSHIP,
            targetId: { in: membershipIds },
          }
        : undefined,
    ].filter(Boolean) as Array<Record<string, unknown>>;

    if (paymentFilters.length > 0) {
      await prisma.payment.deleteMany({
        where: {
          OR: paymentFilters,
        },
      });
    }

    if (membershipIds.length > 0 || userIdList.length > 0) {
      await prisma.userMembership.deleteMany({
        where: {
          OR: [
            userIdList.length > 0 ? { userId: { in: userIdList } } : undefined,
            membershipIds.length > 0
              ? { membershipId: { in: membershipIds } }
              : undefined,
          ].filter(Boolean) as Array<Record<string, unknown>>,
        },
      });
    }

    if (bookingIds.length > 0) {
      await prisma.classBooking.deleteMany({
        where: {
          id: { in: bookingIds },
        },
      });
    }

    if (scheduleIds.length > 0) {
      await prisma.scheduleException.deleteMany({
        where: { scheduleId: { in: scheduleIds } },
      });
      await prisma.scheduleDay.deleteMany({
        where: { scheduleId: { in: scheduleIds } },
      });
      await prisma.classSchedule.deleteMany({
        where: { id: { in: scheduleIds } },
      });
    }

    await prisma.gymClass.deleteMany({
      where: {
        className: {
          startsWith: suitePrefix,
        },
      },
    });

    await prisma.membership.deleteMany({
      where: {
        name: {
          startsWith: suitePrefix,
        },
      },
    });

    if (userIdList.length > 0) {
      await prisma.session.deleteMany({
        where: { userId: { in: userIdList } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIdList } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIdList } },
      });
    }
  }

  function startOfUtcDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  function startOfUtcMonth(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  function addUtcDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  function toUtcDate(dateOnly: string): Date {
    return new Date(`${dateOnly}T00:00:00.000Z`);
  }

  function toDateOnly(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  function resolveCategory(className: string): string {
    if (className.includes('Yoga')) {
      return 'MindBody';
    }
    if (className.includes('Boxing')) {
      return 'Combat';
    }
    if (className.includes('Cycle')) {
      return 'Cardio';
    }
    if (className.includes('Dance')) {
      return 'Rhythm';
    }
    if (className.includes('HIIT')) {
      return 'Conditioning';
    }

    return 'Recovery';
  }

  test('requires authentication for reporting endpoints', async () => {
    const response = await anonymousApi.get('reporting/summary-kpis');

    expect(response.status()).toBe(401);
  });

  test('forbids non-admin users from accessing reporting endpoints', async () => {
    const response = await memberApi.get('reporting/summary-kpis');

    expect(response.status()).toBe(403);
  });

  test('returns summary KPIs using only success payments, active memberships, active trainers, and todays active bookings', async () => {
    const response = await adminApi.get('reporting/summary-kpis');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: SummarySnapshot;
    };

    expect(typeof body.data.totalRevenue).toBe('number');
    expect(typeof body.data.activeMembers).toBe('number');
    expect(typeof body.data.totalTrainers).toBe('number');
    expect(typeof body.data.todaysClassBookings).toBe('number');

    expect(body.data).toEqual({
      totalRevenue: baselineSummary.totalRevenue + 220,
      activeMembers: baselineSummary.activeMembers + 1,
      totalTrainers: baselineSummary.totalTrainers + 1,
      todaysClassBookings: baselineSummary.todaysClassBookings + 1,
    });
  });

  test('returns monthly revenue analytics with source splits and a zero-filled bucket gap', async () => {
    const response = await adminApi.get(
      `reporting/revenue-analytics?startDate=${reportRangeStart}&endDate=${reportRangeEnd}&interval=month`,
    );

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        interval: string;
        startDate: string;
        endDate: string;
        buckets: Array<{
          bucket: string;
          totalRevenue: number;
          membershipRevenue: number;
          classBookingRevenue: number;
        }>;
      };
    };

    expect(body.data.interval).toBe('month');
    expect(body.data.startDate).toBe(reportRangeStart);
    expect(body.data.endDate).toBe(reportRangeEnd);
    expect(body.data.buckets).toEqual([
      {
        bucket: '2035-01-01T00:00:00.000Z',
        totalRevenue: 150,
        membershipRevenue: 100,
        classBookingRevenue: 50,
      },
      {
        bucket: '2035-02-01T00:00:00.000Z',
        totalRevenue: 70,
        membershipRevenue: 0,
        classBookingRevenue: 70,
      },
      {
        bucket: '2035-03-01T00:00:00.000Z',
        totalRevenue: 0,
        membershipRevenue: 0,
        classBookingRevenue: 0,
      },
    ]);
  });

  test('supports daily revenue analytics buckets and preserves empty days', async () => {
    const response = await adminApi.get(
      'reporting/revenue-analytics?startDate=2035-02-10&endDate=2035-02-12&interval=day',
    );

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        interval: string;
        buckets: Array<{
          bucket: string;
          totalRevenue: number;
          membershipRevenue: number;
          classBookingRevenue: number;
        }>;
      };
    };

    expect(body.data.interval).toBe('day');
    expect(body.data.buckets).toEqual([
      {
        bucket: '2035-02-10T00:00:00.000Z',
        totalRevenue: 70,
        membershipRevenue: 0,
        classBookingRevenue: 70,
      },
      {
        bucket: '2035-02-11T00:00:00.000Z',
        totalRevenue: 0,
        membershipRevenue: 0,
        classBookingRevenue: 0,
      },
      {
        bucket: '2035-02-12T00:00:00.000Z',
        totalRevenue: 0,
        membershipRevenue: 0,
        classBookingRevenue: 0,
      },
    ]);
  });

  test('supports weekly revenue analytics buckets and preserves empty weeks', async () => {
    const response = await adminApi.get(
      'reporting/revenue-analytics?startDate=2035-01-08&endDate=2035-01-28&interval=week',
    );

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        interval: string;
        buckets: Array<{
          bucket: string;
          totalRevenue: number;
          membershipRevenue: number;
          classBookingRevenue: number;
        }>;
      };
    };

    expect(body.data.interval).toBe('week');
    expect(body.data.buckets).toEqual([
      {
        bucket: '2035-01-08T00:00:00.000Z',
        totalRevenue: 100,
        membershipRevenue: 100,
        classBookingRevenue: 0,
      },
      {
        bucket: '2035-01-15T00:00:00.000Z',
        totalRevenue: 50,
        membershipRevenue: 0,
        classBookingRevenue: 50,
      },
      {
        bucket: '2035-01-22T00:00:00.000Z',
        totalRevenue: 0,
        membershipRevenue: 0,
        classBookingRevenue: 0,
      },
    ]);
  });

  test('uses the default last-six-month monthly range when revenue analytics dates are omitted', async () => {
    const response = await adminApi.get('reporting/revenue-analytics');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        interval: string;
        startDate: string;
        endDate: string;
        buckets: Array<{
          totalRevenue: number;
          membershipRevenue: number;
          classBookingRevenue: number;
        }>;
      };
    };

    const today = new Date();
    const currentMonthStart = startOfUtcMonth(today);
    const expectedStartDate = new Date(
      Date.UTC(
        currentMonthStart.getUTCFullYear(),
        currentMonthStart.getUTCMonth() - 5,
        1,
      ),
    );

    expect(body.data.interval).toBe('month');
    expect(body.data.startDate).toBe(toDateOnly(expectedStartDate));
    expect(body.data.endDate).toBe(toDateOnly(startOfUtcDay(today)));
    expect(body.data.buckets).toHaveLength(6);
    for (const bucket of body.data.buckets) {
      expect(typeof bucket.totalRevenue).toBe('number');
      expect(typeof bucket.membershipRevenue).toBe('number');
      expect(typeof bucket.classBookingRevenue).toBe('number');
    }
  });

  test('rejects unsupported revenue intervals at DTO validation time', async () => {
    const response = await adminApi.get(
      `reporting/revenue-analytics?startDate=${reportRangeStart}&endDate=${reportRangeEnd}&interval=quarter`,
    );

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(JSON.stringify(body)).toContain('interval');
  });

  test('rejects reversed revenue analytics date ranges', async () => {
    const response = await adminApi.get(
      'reporting/revenue-analytics?startDate=2035-03-31&endDate=2035-01-01&interval=month',
    );

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(JSON.stringify(body)).toContain(
      'startDate must be before or equal to endDate',
    );
  });

  test('returns filtered class performance rankings and category revenue using reporting rules', async () => {
    const response = await adminApi.get(
      `reporting/class-performance?startDate=${reportRangeStart}&endDate=${reportRangeEnd}`,
    );

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        startDate: string | null;
        endDate: string | null;
        topBookedClasses: Array<{
          classId: string;
          className: string;
          category: string;
          bookingCount: number;
        }>;
        revenueByCategory: Array<{
          category: string;
          revenue: number;
        }>;
      };
    };

    expect(body.data.startDate).toBe(reportRangeStart);
    expect(body.data.endDate).toBe(reportRangeEnd);
    expect(body.data.topBookedClasses).toEqual([
      expect.objectContaining({
        className: classNames.yoga,
        category: 'MindBody',
        bookingCount: 3,
      }),
      expect.objectContaining({
        className: classNames.boxing,
        category: 'Combat',
        bookingCount: 1,
      }),
    ]);
    expect(body.data.revenueByCategory).toEqual([
      { category: 'Combat', revenue: 70 },
      { category: 'MindBody', revenue: 50 },
    ]);
  });

  test('defaults class performance to all-time when dates are omitted', async () => {
    const response = await adminApi.get('reporting/class-performance');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        startDate: string | null;
        endDate: string | null;
        topBookedClasses: Array<{
          className: string;
          bookingCount: number;
        }>;
      };
    };

    expect(body.data.startDate).toBeNull();
    expect(body.data.endDate).toBeNull();
    expect(body.data.topBookedClasses.length).toBeLessThanOrEqual(5);
    for (const item of body.data.topBookedClasses) {
      expect(typeof item.className).toBe('string');
      expect(typeof item.bookingCount).toBe('number');
    }
  });

  test('limits filtered class performance rankings to the top five classes in the controlled reporting range', async () => {
    const response = await adminApi.get(
      'reporting/class-performance?startDate=2034-11-01&endDate=2035-03-31',
    );

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: {
        startDate: string | null;
        endDate: string | null;
        topBookedClasses: Array<{
          className: string;
          bookingCount: number;
        }>;
      };
    };

    expect(body.data.startDate).toBe('2034-11-01');
    expect(body.data.endDate).toBe('2035-03-31');
    expect(body.data.topBookedClasses).toHaveLength(5);
    expect(body.data.topBookedClasses.map((item) => item.className)).toEqual([
      classNames.yoga,
      classNames.boxing,
      classNames.cycle,
      classNames.dance,
      classNames.hiit,
    ]);
    expect(body.data.topBookedClasses[0]?.bookingCount).toBe(3);
    expect(
      body.data.topBookedClasses.some((item) => item.className === classNames.zeta),
    ).toBe(false);
  });

  test('rejects one-sided class performance date filters', async () => {
    const response = await adminApi.get(
      `reporting/class-performance?startDate=${reportRangeStart}`,
    );

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(JSON.stringify(body)).toContain(
      'startDate and endDate must both be provided for class performance filters',
    );
  });
});
