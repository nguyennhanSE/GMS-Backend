import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus, PaymentTargetType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Reporting Module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let memberToken: string;
  let membershipId: string;

  const PASSWORD = 'ReportingPass@123';
  const REPORT_MEMBERSHIP_NAME = 'Reporting E2E Membership';
  const YOGA_CLASS_NAME = 'Reporting E2E Yoga';
  const BOXING_CLASS_NAME = 'Reporting E2E Boxing';
  const REPORT_RANGE_START = '2035-01-01';
  const REPORT_RANGE_END = '2035-03-31';

  const TEST_EMAILS = {
    admin: 'reporting-admin@e2e.local',
    activeTrainer: 'reporting-trainer-active@e2e.local',
    inactiveTrainer: 'reporting-trainer-inactive@e2e.local',
    activeMember: 'reporting-member-active@e2e.local',
    bookingMemberA: 'reporting-member-a@e2e.local',
    bookingMemberB: 'reporting-member-b@e2e.local',
    bookingMemberC: 'reporting-member-c@e2e.local',
    expiredMember: 'reporting-member-expired@e2e.local',
  };

  type TestUserKey = keyof typeof TEST_EMAILS;
  const userIds = {} as Record<TestUserKey, string>;

  let baselineSummary: {
    totalRevenue: number;
    activeMembers: number;
    totalTrainers: number;
    todaysClassBookings: number;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    await cleanupReportingFixtures();
    baselineSummary = await getSummaryBaseline();
    await seedReportingFixtures();

    adminToken = await login(TEST_EMAILS.admin, PASSWORD);
    memberToken = await login(TEST_EMAILS.activeMember, PASSWORD);
  }, 90000);

  afterAll(async () => {
    if (prisma) {
      await cleanupReportingFixtures();
    }

    if (app) {
      await app.close();
    }
  });

  async function ensureRole(name: string, description: string) {
    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) {
      return existing;
    }

    return prisma.role.create({
      data: { name, description },
    });
  }

  async function createUser(
    key: TestUserKey,
    roles: string[],
    status: string,
    firstName: string,
    lastName: string,
  ) {
    const hashedPassword = await bcrypt.hash(PASSWORD, 10);
    const created = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: TEST_EMAILS[key],
        password: hashedPassword,
        status,
        userRole: {
          create: roles.map((roleId) => ({ roleId })),
        },
      },
    });

    userIds[key] = created.id;
    return created;
  }

  async function login(email: string, password: string): Promise<string> {
    const response = await supertest
      .default(app.getHttpServer())
      .post('/auth/login')
      .send({ username: email, password })
      .expect(201);

    const accessToken = response.body?.data?.accessToken as string | undefined;
    if (!accessToken) {
      throw new Error(`Failed to login as ${email}`);
    }

    return accessToken;
  }

  function authGet(token: string, path: string) {
    return supertest
      .default(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  }

  function utcDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  function todayUtc(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  function addUtcDays(date: Date, days: number): Date {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
  }

  async function getSummaryBaseline() {
    const now = new Date();
    const startOfTodayUtc = todayUtc();
    const startOfTomorrowUtc = addUtcDays(startOfTodayUtc, 1);

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
      'FormerTrainer',
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
        name: REPORT_MEMBERSHIP_NAME,
        description: 'Membership used by reporting e2e tests',
        minPrice: 100,
        purchasePrice: 100,
        level: 'BASIC',
      },
    });
    membershipId = membership.id;

    await prisma.userMembership.create({
      data: {
        userId: userIds.activeMember,
        membershipId,
        membershipName: REPORT_MEMBERSHIP_NAME,
        membershipDescription: 'Active reporting e2e membership',
        status: 'normal',
        startDate: utcDateOnly('2034-12-01'),
        endDate: utcDateOnly('2040-01-01'),
      },
    });

    await prisma.userMembership.create({
      data: {
        userId: userIds.expiredMember,
        membershipId,
        membershipName: REPORT_MEMBERSHIP_NAME,
        membershipDescription: 'Expired reporting e2e membership',
        status: 'expired',
        startDate: utcDateOnly('2034-01-01'),
        endDate: utcDateOnly('2034-12-31'),
      },
    });

    const [yogaClass, boxingClass] = await Promise.all([
      prisma.gymClass.create({
        data: {
          className: YOGA_CLASS_NAME,
          description: 'Reporting yoga class',
          difficultyLevel: 'Beginner',
          category: 'MindBody',
          isActive: true,
        },
      }),
      prisma.gymClass.create({
        data: {
          className: BOXING_CLASS_NAME,
          description: 'Reporting boxing class',
          difficultyLevel: 'Intermediate',
          category: 'Combat',
          isActive: true,
        },
      }),
    ]);

    const [yogaSchedule, boxingSchedule] = await Promise.all([
      prisma.classSchedule.create({
        data: {
          classId: yogaClass.id,
          trainerId: userIds.activeTrainer,
          dayOfWeek: 'MON',
          startTime: new Date('1970-01-01T08:00:00.000Z'),
          endTime: new Date('1970-01-01T09:00:00.000Z'),
          capacity: 25,
          price: 50,
          location: 'Reporting Room A',
          isActive: true,
        },
      }),
      prisma.classSchedule.create({
        data: {
          classId: boxingClass.id,
          trainerId: userIds.activeTrainer,
          dayOfWeek: 'TUE',
          startTime: new Date('1970-01-01T10:00:00.000Z'),
          endTime: new Date('1970-01-01T11:00:00.000Z'),
          capacity: 20,
          price: 70,
          location: 'Reporting Room B',
          isActive: true,
        },
      }),
    ]);

    const today = todayUtc();
    const januaryBooking = utcDateOnly('2035-01-15');
    const februaryBooking = utcDateOnly('2035-02-20');
    const marchBooking = utcDateOnly('2035-03-05');
    const boxingBookingDate = utcDateOnly('2035-02-10');

    const [
      todayConfirmed,
      todayCancelled,
      yogaJanuary,
      yogaFebruary,
      yogaMarch,
      boxingFebruary,
    ] = await Promise.all([
      prisma.classBooking.create({
        data: {
          userId: userIds.activeMember,
          classScheduleId: yogaSchedule.id,
          bookingStartDate: today,
          bookingEndDate: today,
          status: 'confirmed',
        },
      }),
      prisma.classBooking.create({
        data: {
          userId: userIds.bookingMemberA,
          classScheduleId: yogaSchedule.id,
          bookingStartDate: today,
          bookingEndDate: today,
          status: 'cancelled',
        },
      }),
      prisma.classBooking.create({
        data: {
          userId: userIds.activeMember,
          classScheduleId: yogaSchedule.id,
          bookingStartDate: januaryBooking,
          bookingEndDate: januaryBooking,
          status: 'attended',
        },
      }),
      prisma.classBooking.create({
        data: {
          userId: userIds.bookingMemberB,
          classScheduleId: yogaSchedule.id,
          bookingStartDate: februaryBooking,
          bookingEndDate: februaryBooking,
          status: 'pending',
        },
      }),
      prisma.classBooking.create({
        data: {
          userId: userIds.bookingMemberC,
          classScheduleId: yogaSchedule.id,
          bookingStartDate: marchBooking,
          bookingEndDate: marchBooking,
          status: 'confirmed',
        },
      }),
      prisma.classBooking.create({
        data: {
          userId: userIds.expiredMember,
          classScheduleId: boxingSchedule.id,
          bookingStartDate: boxingBookingDate,
          bookingEndDate: boxingBookingDate,
          status: 'confirmed',
        },
      }),
    ]);

    await prisma.payment.createMany({
      data: [
        {
          userId: userIds.activeMember,
          targetType: PaymentTargetType.MEMBERSHIP,
          targetId: membershipId,
          amount: 100,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date('2035-01-10T08:00:00.000Z'),
        },
        {
          userId: userIds.activeMember,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: yogaJanuary.id,
          amount: 50,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date('2035-01-15T12:00:00.000Z'),
        },
        {
          userId: userIds.expiredMember,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: boxingFebruary.id,
          amount: 70,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date('2035-02-10T12:00:00.000Z'),
        },
        {
          userId: userIds.activeMember,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: todayConfirmed.id,
          amount: 999,
          status: PaymentStatus.FAILED,
        },
        {
          userId: userIds.bookingMemberB,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: yogaFebruary.id,
          amount: 888,
          status: PaymentStatus.PENDING,
        },
        {
          userId: userIds.bookingMemberA,
          targetType: PaymentTargetType.CLASS_BOOKING,
          targetId: todayCancelled.id,
          amount: 777,
          status: PaymentStatus.REFUNDED,
          paidAt: new Date('2035-03-20T09:00:00.000Z'),
        },
      ],
    });
  }

  async function cleanupReportingFixtures() {
    const emailList = Object.values(TEST_EMAILS);

    await prisma.payment.deleteMany({
      where: {
        user: { email: { in: emailList } },
      },
    });

    await prisma.userMembership.deleteMany({
      where: {
        user: { email: { in: emailList } },
      },
    });

    await prisma.classBooking.deleteMany({
      where: {
        user: { email: { in: emailList } },
      },
    });

    await prisma.trainerAvailability.deleteMany({
      where: {
        trainer: { email: { in: emailList } },
      },
    });

    await prisma.scheduleException.deleteMany({
      where: {
        schedule: {
          gymClass: {
            className: { in: [YOGA_CLASS_NAME, BOXING_CLASS_NAME] },
          },
        },
      },
    });

    await prisma.scheduleDay.deleteMany({
      where: {
        schedule: {
          gymClass: {
            className: { in: [YOGA_CLASS_NAME, BOXING_CLASS_NAME] },
          },
        },
      },
    });

    await prisma.classSchedule.deleteMany({
      where: {
        gymClass: {
          className: { in: [YOGA_CLASS_NAME, BOXING_CLASS_NAME] },
        },
      },
    });

    await prisma.gymClass.deleteMany({
      where: {
        className: { in: [YOGA_CLASS_NAME, BOXING_CLASS_NAME] },
      },
    });

    await prisma.membership.deleteMany({
      where: {
        name: REPORT_MEMBERSHIP_NAME,
      },
    });

    await prisma.session.deleteMany({
      where: {
        user: { email: { in: emailList } },
      },
    });

    await prisma.userRole.deleteMany({
      where: {
        user: { email: { in: emailList } },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: { in: emailList },
      },
    });
  }

  describe('authorization', () => {
    it('rejects non-admin users', async () => {
      const response = await authGet(memberToken, '/reporting/summary-kpis');

      expect(response.status).toBe(403);
    });
  });

  describe('GET /reporting/summary-kpis', () => {
    it('returns KPI totals with reporting fixtures applied on top of the baseline', async () => {
      const response = await authGet(adminToken, '/reporting/summary-kpis');

      expect(response.status).toBe(200);
      expect(typeof response.body.data.totalRevenue).toBe('number');
      expect(typeof response.body.data.activeMembers).toBe('number');
      expect(typeof response.body.data.totalTrainers).toBe('number');
      expect(typeof response.body.data.todaysClassBookings).toBe('number');

      expect(response.body.data.totalRevenue).toBe(
        baselineSummary.totalRevenue + 220,
      );
      expect(response.body.data.activeMembers).toBe(
        baselineSummary.activeMembers + 1,
      );
      expect(response.body.data.totalTrainers).toBe(
        baselineSummary.totalTrainers + 1,
      );
      expect(response.body.data.todaysClassBookings).toBe(
        baselineSummary.todaysClassBookings + 1,
      );
    });
  });

  describe('GET /reporting/revenue-analytics', () => {
    it('returns monthly buckets with zero-filled gaps and source breakdowns', async () => {
      const response = await authGet(
        adminToken,
        `/reporting/revenue-analytics?startDate=${REPORT_RANGE_START}&endDate=${REPORT_RANGE_END}&interval=month`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.interval).toBe('month');
      expect(response.body.data.startDate).toBe(REPORT_RANGE_START);
      expect(response.body.data.endDate).toBe(REPORT_RANGE_END);
      expect(response.body.data.buckets).toHaveLength(3);

      const bucketMap = new Map(
        response.body.data.buckets.map(
          (bucket: {
            bucket: string;
            totalRevenue: number;
            membershipRevenue: number;
            classBookingRevenue: number;
          }) => [bucket.bucket, bucket],
        ),
      );

      expect(bucketMap.get('2035-01-01T00:00:00.000Z')).toEqual({
        bucket: '2035-01-01T00:00:00.000Z',
        totalRevenue: 150,
        membershipRevenue: 100,
        classBookingRevenue: 50,
      });
      expect(bucketMap.get('2035-02-01T00:00:00.000Z')).toEqual({
        bucket: '2035-02-01T00:00:00.000Z',
        totalRevenue: 70,
        membershipRevenue: 0,
        classBookingRevenue: 70,
      });
      expect(bucketMap.get('2035-03-01T00:00:00.000Z')).toEqual({
        bucket: '2035-03-01T00:00:00.000Z',
        totalRevenue: 0,
        membershipRevenue: 0,
        classBookingRevenue: 0,
      });
    });

    it('uses the default last-six-month monthly window when dates are omitted', async () => {
      const response = await authGet(adminToken, '/reporting/revenue-analytics');

      expect(response.status).toBe(200);
      expect(response.body.data.interval).toBe('month');
      expect(response.body.data.buckets).toHaveLength(6);
    });
  });

  describe('GET /reporting/class-performance', () => {
    it('returns top booked classes and revenue by category for a filtered range', async () => {
      const response = await authGet(
        adminToken,
        `/reporting/class-performance?startDate=${REPORT_RANGE_START}&endDate=${REPORT_RANGE_END}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.startDate).toBe(REPORT_RANGE_START);
      expect(response.body.data.endDate).toBe(REPORT_RANGE_END);

      expect(response.body.data.topBookedClasses[0]).toMatchObject({
        className: YOGA_CLASS_NAME,
        category: 'MindBody',
        bookingCount: 3,
      });
      expect(response.body.data.topBookedClasses[1]).toMatchObject({
        className: BOXING_CLASS_NAME,
        category: 'Combat',
        bookingCount: 1,
      });

      expect(response.body.data.revenueByCategory).toEqual([
        { category: 'Combat', revenue: 70 },
        { category: 'MindBody', revenue: 50 },
      ]);
    });

    it('defaults to all-time when both dates are omitted', async () => {
      const response = await authGet(adminToken, '/reporting/class-performance');

      expect(response.status).toBe(200);
      expect(response.body.data.startDate).toBeNull();
      expect(response.body.data.endDate).toBeNull();
    });

    it('rejects one-sided date filters', async () => {
      const response = await authGet(
        adminToken,
        `/reporting/class-performance?startDate=${REPORT_RANGE_START}`,
      );

      expect(response.status).toBe(400);
    });
  });
});
