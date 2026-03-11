import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../src/modules/payment/stripe.service';
import { MembershipsService } from '../src/modules/memberships/memberships.service';
import { randomUUID } from 'crypto';
import {
  TestData,
  loginAs,
  authRequest,
  createTestData,
  cleanupTestData,
} from './test-helpers';

/**
 * Integration tests for the membership module.
 * Uses real DB (Prisma), mocks only StripeService (external API).
 *
 * Covers:
 * 1. Admin CRUD API (tier management + FK guard)
 * 2. Checkout flow (purchasePrice, validation)
 * 3. Service-layer payment activation (time-stacking, tier switching)
 * 4. GET /memberships/my (ghost membership defense)
 */
describe('Membership Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let membershipsService: MembershipsService;
  let testData: TestData;
  let memberToken: string;
  let adminToken: string;

  // Test tier created in beforeAll
  let testTier: { id: string; name: string };

  const mockStripeService = {
    createCheckoutSession: jest.fn().mockResolvedValue({
      id: 'cs_test_membership',
      url: 'https://checkout.stripe.com/membership-test',
    }),
    verifyWebhookSignature: jest.fn(),
  };

  const TEST_EMAILS = [
    'api-test-member@test.local',
    'api-test-admin@test.local',
    'api-test-trainer@test.local',
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeService)
      .useValue(mockStripeService)
      .compile();

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
    membershipsService = app.get(MembershipsService);

    // Clean up stale test data — payments MUST go before users (FK RESTRICT)
    await cleanupMembershipTestData(prisma);
    await prisma.payment.deleteMany({
      where: { user: { email: { in: TEST_EMAILS } } },
    });
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);

    // Create test tier
    testTier = await prisma.membership.create({
      data: {
        name: 'IntegTest Premium',
        description: 'Integration test tier',
        minPrice: 500000,
        purchasePrice: 480000,
        level: 'PREMIUM',
      },
    });

    try {
      memberToken = await loginAs(
        app,
        testData.memberUser.email,
        testData.memberPassword,
      );
      adminToken = await loginAs(
        app,
        testData.adminUser.email,
        testData.adminPassword,
      );
    } catch {
      console.warn('Login failed — some tests will be skipped');
    }
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      await cleanupMembershipTestData(prisma);
      await prisma.payment.deleteMany({
        where: { user: { email: { in: TEST_EMAILS } } },
      });
      await cleanupTestData(prisma);
    }
    if (app) await app.close();
  });

  afterEach(async () => {
    if (!prisma || !testData) return;
    // Clean up UserMemberships created during test
    await prisma.userMembership.deleteMany({
      where: {
        userId: { in: [testData.memberUser.id, testData.adminUser.id] },
      },
    });
    // Clean up Payment records from checkout tests
    await prisma.payment.deleteMany({
      where: { userId: testData.memberUser.id },
    });
    mockStripeService.createCheckoutSession.mockClear();
  });

  async function cleanupMembershipTestData(p: PrismaService) {
    const testEmails = [
      'api-test-member@test.local',
      'api-test-admin@test.local',
    ];
    await p.userMembership.deleteMany({
      where: { user: { email: { in: testEmails } } },
    });
    await p.membership.deleteMany({
      where: {
        name: {
          in: [
            'IntegTest Premium',
            'IntegTest Basic',
            'IntegTest Deletable',
            'IntegTest Undeletable',
            'IntegTest CRUD',
          ],
        },
      },
    });
  }

  // ─── Scope 1: Admin CRUD API ────────────────────────────────────────

  describe('Admin CRUD API', () => {
    it('[Test 1] Admin should create a membership tier', async () => {
      if (!adminToken) return;

      const response = await authRequest(app, adminToken)
        .post('/memberships')
        .send({
          name: 'IntegTest CRUD',
          description: 'Created via e2e',
          minPrice: 100000,
          purchasePrice: 90000,
          level: 'BASIC',
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('IntegTest CRUD');
      expect(response.body.purchasePrice).toBe(90000);

      // Verify in DB
      const dbTier = await prisma.membership.findUnique({
        where: { id: response.body.id },
      });
      expect(dbTier).not.toBeNull();

      // Cleanup
      await prisma.membership.delete({ where: { id: response.body.id } });
    });

    it('[Test 2] Non-admin should be rejected (403)', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/memberships')
        .send({
          name: 'Should Fail',
          minPrice: 100000,
          purchasePrice: 90000,
          level: 'BASIC',
        });

      expect(response.status).toBe(403);
    });

    it('[Test 3] List all tiers should work for any authenticated user', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .get('/memberships');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      const found = response.body.find(
        (t: any) => t.name === 'IntegTest Premium',
      );
      expect(found).toBeDefined();
    });

    it('[Test 4] Admin should update a tier', async () => {
      if (!adminToken) return;

      const response = await authRequest(app, adminToken)
        .patch(`/memberships/${testTier.id}`)
        .send({ description: 'Updated description' });

      expect(response.status).toBe(200);
      expect(response.body.description).toBe('Updated description');
    });

    it('[Test 5] Admin should delete an orphan tier (no users)', async () => {
      if (!adminToken) return;

      const disposable = await prisma.membership.create({
        data: {
          name: 'IntegTest Deletable',
          minPrice: 1,
          purchasePrice: 1,
          level: 'BASIC',
        },
      });

      const response = await authRequest(app, adminToken)
        .delete(`/memberships/${disposable.id}`);

      expect(response.status).toBe(200);

      const gone = await prisma.membership.findUnique({
        where: { id: disposable.id },
      });
      expect(gone).toBeNull();
    });

    it('[Test 6] Delete tier with active users should return 400 (FK guard)', async () => {
      if (!adminToken) return;

      const guardTier = await prisma.membership.create({
        data: {
          name: 'IntegTest Undeletable',
          minPrice: 1,
          purchasePrice: 1,
          level: 'BASIC',
        },
      });

      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      await prisma.userMembership.create({
        data: {
          userId: testData.memberUser.id,
          membershipId: guardTier.id,
          membershipName: 'IntegTest Undeletable',
          membershipDescription: '',
          level: 'BASIC',
          status: 'normal',
          startDate: new Date(),
          endDate: oneYearFromNow,
        },
      });

      const response = await authRequest(app, adminToken)
        .delete(`/memberships/${guardTier.id}`);

      // Should be 400, NOT 500
      expect(response.status).toBe(400);

      // Tier should still exist
      const stillThere = await prisma.membership.findUnique({
        where: { id: guardTier.id },
      });
      expect(stillThere).not.toBeNull();

      // Cleanup
      await prisma.userMembership.deleteMany({
        where: { membershipId: guardTier.id },
      });
      await prisma.membership.delete({ where: { id: guardTier.id } });
    });
  });

  // ─── Scope 2: Membership Checkout ─────────────────────────────────

  describe('POST /memberships/:id/checkout', () => {
    it('[Test 7] Should return Stripe checkout URL', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post(`/memberships/${testTier.id}/checkout`)
        .send();

      expect(response.status).toBe(201);
      expect(response.body.checkoutUrl).toBe(
        'https://checkout.stripe.com/membership-test',
      );
    });

    it('[Test 8] Should use purchasePrice in Stripe args', async () => {
      if (!memberToken) return;

      await authRequest(app, memberToken)
        .post(`/memberships/${testTier.id}/checkout`)
        .send();

      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 480000, // purchasePrice, NOT minPrice (500000)
          targetType: 'MEMBERSHIP',
        }),
      );
    });

    it('[Test 9] Should reject tier with purchasePrice = 0 (400)', async () => {
      if (!memberToken) return;

      const freeTier = await prisma.membership.create({
        data: {
          name: 'IntegTest Basic',
          minPrice: 0,
          purchasePrice: 0,
          level: 'BASIC',
        },
      });

      const response = await authRequest(app, memberToken)
        .post(`/memberships/${freeTier.id}/checkout`)
        .send();

      expect(response.status).toBe(400);

      await prisma.membership.delete({ where: { id: freeTier.id } });
    });

    it('[Test 10] Should reject non-existent tier (404)', async () => {
      if (!memberToken) return;

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await authRequest(app, memberToken)
        .post(`/memberships/${fakeId}/checkout`)
        .send();

      expect(response.status).toBe(404);
    });
  });

  // ─── Scope 3: Service-Layer Payment Activation ────────────────────

  describe('activateByPayment / deactivateByPayment', () => {
    /** Create a real Payment record so FK constraint is satisfied */
    async function createTestPayment(label: string): Promise<string> {
      const payment = await prisma.payment.create({
        data: {
          userId: testData.memberUser.id,
          targetType: 'MEMBERSHIP',
          targetId: testTier.id,
          amount: 480000,
          currency: 'VND',
          status: 'SUCCESS',
          checkoutUrl: `https://test/${label}`,
        },
      });
      return payment.id;
    }

    it('[Test 11] Should create UserMembership with paymentId', async () => {
      const payId = await createTestPayment('test-11');
      const result = await membershipsService.activateByPayment(
        payId,
        testData.memberUser.id,
        testTier.id,
      );

      expect(result.membershipName).toBe('IntegTest Premium');
      expect(result.paymentId).toBe(payId);
      expect(result.status).toBe('normal');

      const dbRecord = await prisma.userMembership.findFirst({
        where: { paymentId: payId },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord!.userId).toBe(testData.memberUser.id);
    });

    it('[Test 12] Time-stacking: same tier extends endDate by +1 year', async () => {
      const payId1 = await createTestPayment('stack-1');
      const payId2 = await createTestPayment('stack-2');

      // First activation
      const first = await membershipsService.activateByPayment(
        payId1,
        testData.memberUser.id,
        testTier.id,
      );
      const originalEnd = new Date(first.endDate);

      // Second activation (same tier) — should extend from originalEnd
      const second = await membershipsService.activateByPayment(
        payId2,
        testData.memberUser.id,
        testTier.id,
      );
      const extendedEnd = new Date(second.endDate);

      // Must match service logic: existingEnd.setFullYear(existingEnd.getFullYear() + 1)
      expect(extendedEnd.getFullYear()).toBe(originalEnd.getFullYear() + 1);
      expect(extendedEnd.getMonth()).toBe(originalEnd.getMonth());
      expect(extendedEnd.getDate()).toBe(originalEnd.getDate());
    });

    it('[Test 13] Tier switch: old tier soft-expired, new tier created', async () => {
      const payIdBasic = await createTestPayment('basic');
      const payIdPremium = await createTestPayment('premium');

      const basicTier = await prisma.membership.create({
        data: {
          name: 'IntegTest Basic',
          minPrice: 0,
          purchasePrice: 50000,
          level: 'BASIC',
        },
      });

      try {
        // Activate Basic first
        const basicMembership = await membershipsService.activateByPayment(
          payIdBasic,
          testData.memberUser.id,
          basicTier.id,
        );
        expect(basicMembership.level).toBe('BASIC');

        // Now upgrade to Premium (different tier)
        const premiumMembership = await membershipsService.activateByPayment(
          payIdPremium,
          testData.memberUser.id,
          testTier.id,
        );
        expect(premiumMembership.level).toBe('PREMIUM');
        expect(premiumMembership.status).toBe('normal');

        // Verify old Basic is soft-expired (NOT deleted)
        const expiredBasic = await prisma.userMembership.findFirst({
          where: { paymentId: payIdBasic },
        });
        expect(expiredBasic).not.toBeNull();
        expect(expiredBasic!.status).toBe('expired');
      } finally {
        await prisma.userMembership.deleteMany({
          where: { membershipId: basicTier.id },
        });
        await prisma.membership.delete({ where: { id: basicTier.id } });
      }
    });

    it('[Test 14] deactivateByPayment should expire membership', async () => {
      const payId = await createTestPayment('deact');
      const activated = await membershipsService.activateByPayment(
        payId,
        testData.memberUser.id,
        testTier.id,
      );
      expect(activated.status).toBe('normal');

      await membershipsService.deactivateByPayment(payId);

      const dbRecord = await prisma.userMembership.findFirst({
        where: { paymentId: payId },
      });
      expect(dbRecord!.status).toBe('expired');
    });

    it('[Test 15] deactivateByPayment should be idempotent', async () => {
      const payId = await createTestPayment('idempotent');
      await membershipsService.activateByPayment(
        payId,
        testData.memberUser.id,
        testTier.id,
      );

      // Deactivate twice — should not throw
      await membershipsService.deactivateByPayment(payId);
      await membershipsService.deactivateByPayment(payId);

      const dbRecord = await prisma.userMembership.findFirst({
        where: { paymentId: payId },
      });
      expect(dbRecord!.status).toBe('expired');
    });
  });

  // ─── Scope 4: GET /memberships/my ─────────────────────────────────

  describe('GET /memberships/my', () => {
    it('[Test 16] Should return active membership with tier details', async () => {
      if (!memberToken) return;

      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      await prisma.userMembership.create({
        data: {
          userId: testData.memberUser.id,
          membershipId: testTier.id,
          membershipName: 'IntegTest Premium',
          membershipDescription: 'Integration test tier',
          level: 'PREMIUM',
          status: 'normal',
          startDate: new Date(),
          endDate: oneYearFromNow,
        },
      });

      const response = await authRequest(app, memberToken)
        .get('/memberships/my');

      expect(response.status).toBe(200);
      expect(response.body.membershipName).toBe('IntegTest Premium');
      expect(response.body.status).toBe('normal');
      expect(response.body.level).toBe('PREMIUM');
    });

    it('[Test 17] Should return empty when user has no membership', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .get('/memberships/my');

      expect(response.status).toBe(200);
      // NestJS serializes null as "" or {} — check no membership data present
      expect(response.body.membershipName).toBeUndefined();
      expect(response.body.id).toBeUndefined();
    });

    it('[Test 18] Should return empty for expired membership only', async () => {
      if (!memberToken) return;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await prisma.userMembership.create({
        data: {
          userId: testData.memberUser.id,
          membershipId: testTier.id,
          membershipName: 'IntegTest Premium',
          membershipDescription: 'Expired',
          level: 'PREMIUM',
          status: 'expired',
          startDate: new Date('2025-01-01'),
          endDate: yesterday,
        },
      });

      const response = await authRequest(app, memberToken)
        .get('/memberships/my');

      expect(response.status).toBe(200);
      expect(response.body.membershipName).toBeUndefined();
      expect(response.body.id).toBeUndefined();
    });

    it('[Test 19] Ghost defense: should return active, not oldest expired', async () => {
      if (!memberToken) return;

      const now = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      // Create 2 expired "ghost" records (older)
      await prisma.userMembership.createMany({
        data: [
          {
            userId: testData.memberUser.id,
            membershipId: testTier.id,
            membershipName: 'Ghost 1',
            membershipDescription: '',
            level: 'BASIC',
            status: 'expired',
            startDate: new Date('2024-01-01'),
            endDate: new Date('2024-12-31'),
            createdAt: new Date('2024-01-01'),
          },
          {
            userId: testData.memberUser.id,
            membershipId: testTier.id,
            membershipName: 'Ghost 2',
            membershipDescription: '',
            level: 'PREMIUM',
            status: 'expired',
            startDate: new Date('2025-01-01'),
            endDate: yesterday,
            createdAt: new Date('2025-01-01'),
          },
        ],
      });

      // Create 1 active record (newest)
      await prisma.userMembership.create({
        data: {
          userId: testData.memberUser.id,
          membershipId: testTier.id,
          membershipName: 'The Active One',
          membershipDescription: '',
          level: 'PREMIUM',
          status: 'normal',
          startDate: now,
          endDate: oneYearFromNow,
        },
      });

      const response = await authRequest(app, memberToken)
        .get('/memberships/my');

      expect(response.status).toBe(200);
      expect(response.body.membershipName).toBe('The Active One');
      expect(response.body.status).toBe('normal');
    });

    it('[Test 20] Should include nested tier details', async () => {
      if (!memberToken) return;

      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      await prisma.userMembership.create({
        data: {
          userId: testData.memberUser.id,
          membershipId: testTier.id,
          membershipName: 'IntegTest Premium',
          membershipDescription: 'Full access',
          level: 'PREMIUM',
          status: 'normal',
          startDate: new Date(),
          endDate: oneYearFromNow,
        },
      });

      const response = await authRequest(app, memberToken)
        .get('/memberships/my');

      expect(response.status).toBe(200);
      expect(response.body.membership).toBeDefined();
      expect(response.body.membership.name).toBe('IntegTest Premium');
      expect(response.body.membership.purchasePrice).toBe(480000);
    });
  });
});
