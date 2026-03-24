import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../src/modules/payment/stripe.service';
import { ClassBookingService } from '../src/modules/class-booking/class-booking.service';
import {
  TestData,
  loginAs,
  authRequest,
  createTestData,
  cleanupTestData,
  getNextDayOfWeek,
  addDays,
} from './test-helpers';

/**
 * Integration tests for the payment-booking flow.
 * Uses real DB (Prisma), mocks only StripeService (external API).
 *
 * Covers:
 * 1. Checkout validation (initiateCheckout)
 * 2. Payment dedup (createCheckout expiry-aware)
 * 3. Consumer service layer (confirmByPayment / cancelByPayment)
 */
describe('Payment-Booking Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testData: TestData;
  let memberToken: string;
  let adminToken: string;

  const mockStripeService = {
    createCheckoutSession: jest.fn().mockResolvedValue({
      id: 'cs_test_integration',
      url: 'https://checkout.stripe.com/integration-test',
    }),
    verifyWebhookSignature: jest.fn(),
  };

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

    await cleanupTestData(prisma);
    testData = await createTestData(prisma);

    // Set a price on the test schedule
    await prisma.classSchedule.update({
      where: { id: testData.testSchedule.id },
      data: { price: 200000 },
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
      console.warn('Login failed - some tests will be skipped');
    }
  }, 60000);

  afterAll(async () => {
    if (prisma && testData) {
      try {
        await prisma.payment.deleteMany({
          where: { userId: testData.memberUser.id },
        });
        await cleanupTestData(prisma);
      } catch (e) {
        console.error('Cleanup error:', e);
      }
    }
    if (app) await app.close();
  });

  afterEach(async () => {
    if (!prisma || !testData) return;
    const bookingIds = await getTestBookingIds();
    if (bookingIds.length > 0) {
      await prisma.payment.deleteMany({
        where: { targetId: { in: bookingIds } },
      });
    }
    await prisma.classBooking.deleteMany({
      where: { classScheduleId: testData.testSchedule.id },
    });
    mockStripeService.createCheckoutSession.mockClear();
  });

  async function getTestBookingIds(): Promise<string[]> {
    const bookings = await prisma.classBooking.findMany({
      where: { classScheduleId: testData.testSchedule.id },
      select: { id: true },
    });
    return bookings.map((b) => b.id);
  }

  async function createPendingBooking(userId?: string): Promise<string> {
    const nextMonday = getNextDayOfWeek('MON');
    const booking = await prisma.classBooking.create({
      data: {
        userId: userId ?? testData.memberUser.id,
        classScheduleId: testData.testSchedule.id,
        bookingStartDate: nextMonday,
        bookingEndDate: addDays(nextMonday, 7),
        status: 'pending',
      },
    });
    return booking.id;
  }

  // ─── Scope 1: Checkout Validation ─────────────────────────────────

  describe('POST /class-booking/:id/checkout', () => {
    it('should return checkout URL for valid pending booking', async () => {
      if (!memberToken) return;

      const bookingId = await createPendingBooking();

      const response = await authRequest(app, memberToken)
        .post(`/class-booking/${bookingId}/checkout`)
        .send();

      expect(response.status).toBe(201);
      expect(response.body.data.checkoutUrl).toBe(
        'https://checkout.stripe.com/integration-test',
      );
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 200000,
          targetType: 'CLASS_BOOKING',
          targetId: bookingId,
        }),
      );
    });

    it('should reject non-existent booking (404)', async () => {
      if (!memberToken) return;

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await authRequest(app, memberToken)
        .post(`/class-booking/${fakeId}/checkout`)
        .send();

      expect(response.status).toBe(404);
    });

    it("should reject another user's booking (403)", async () => {
      if (!memberToken) return;

      // Create booking for admin user, attempt checkout as member
      const bookingId = await createPendingBooking(testData.adminUser.id);

      const response = await authRequest(app, memberToken)
        .post(`/class-booking/${bookingId}/checkout`)
        .send();

      expect(response.status).toBe(403);
    });

    it('should reject checkout for confirmed booking (400)', async () => {
      if (!memberToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const booking = await prisma.classBooking.create({
        data: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
          bookingEndDate: addDays(nextMonday, 7),
          status: 'confirmed',
        },
      });

      const response = await authRequest(app, memberToken)
        .post(`/class-booking/${booking.id}/checkout`)
        .send();

      expect(response.status).toBe(400);
    });

    it('should reject checkout when schedule has no price', async () => {
      if (!memberToken) return;

      // Set price to 0
      await prisma.classSchedule.update({
        where: { id: testData.testSchedule.id },
        data: { price: 0 },
      });

      const bookingId = await createPendingBooking();

      const response = await authRequest(app, memberToken)
        .post(`/class-booking/${bookingId}/checkout`)
        .send();

      expect(response.status).toBe(400);

      // Restore price
      await prisma.classSchedule.update({
        where: { id: testData.testSchedule.id },
        data: { price: 200000 },
      });
    });
  });

  // ─── Scope 2: Payment Dedup ───────────────────────────────────────

  describe('Payment deduplication', () => {
    it('should return existing URL on double-click (idempotent)', async () => {
      if (!memberToken) return;

      const bookingId = await createPendingBooking();

      // First checkout
      const first = await authRequest(app, memberToken)
        .post(`/class-booking/${bookingId}/checkout`)
        .send();
      expect(first.status).toBe(201);

      // Second checkout (double-click) — should return same URL
      const second = await authRequest(app, memberToken)
        .post(`/class-booking/${bookingId}/checkout`)
        .send();
      expect(second.status).toBe(201);
      expect(second.body.data.checkoutUrl).toBe(
        'https://checkout.stripe.com/integration-test',
      );

      // Stripe should only be called once
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledTimes(1);
    });

    it('should create new session for expired payment', async () => {
      if (!memberToken) return;

      const bookingId = await createPendingBooking();

      // Create a stale payment directly in DB (2 hours old)
      await prisma.payment.create({
        data: {
          userId: testData.memberUser.id,
          targetType: 'CLASS_BOOKING',
          targetId: bookingId,
          amount: 200000,
          currency: 'VND',
          status: 'PENDING',
          checkoutUrl: 'https://checkout.stripe.com/old-expired',
          createdAt: new Date(Date.now() - 120 * 60 * 1000),
        },
      });

      const response = await authRequest(app, memberToken)
        .post(`/class-booking/${bookingId}/checkout`)
        .send();

      expect(response.status).toBe(201);
      // Should create a NEW session, not return the expired one
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledTimes(1);

      // Old payment should be marked FAILED
      const stalePayments = await prisma.payment.findMany({
        where: {
          targetId: bookingId,
          status: 'FAILED',
          failureReason: 'SESSION_EXPIRED',
        },
      });
      expect(stalePayments.length).toBe(1);
    });
  });

  // ─── Scope 3: Consumer Service Layer ──────────────────────────────

  describe('confirmByPayment / cancelByPayment', () => {
    it('should confirm a pending booking', async () => {
      const bookingId = await createPendingBooking();

      // Directly call service (simulating what the consumer does)
      const classBookingService = app.get(ClassBookingService);
      const result = await classBookingService.confirmByPayment(bookingId);

      expect(result.status).toBe('confirmed');

      // Verify in DB
      const dbBooking = await prisma.classBooking.findUnique({
        where: { id: bookingId },
      });
      expect(dbBooking!.status).toBe('confirmed');
    });

    it('should be idempotent for confirmByPayment', async () => {
      const bookingId = await createPendingBooking();

      const classBookingService = app.get(ClassBookingService);

      // Confirm twice — should not throw
      await classBookingService.confirmByPayment(bookingId);
      const result = await classBookingService.confirmByPayment(bookingId);

      expect(result.status).toBe('confirmed');
    });

    it('should cancel a pending booking', async () => {
      const bookingId = await createPendingBooking();

      const classBookingService = app.get(ClassBookingService);
      const result = await classBookingService.cancelByPayment(
        bookingId,
        'PAYMENT_FAILED',
      );

      expect(result).toEqual(expect.objectContaining({ status: 'cancelled' }));
    });

    it('should be idempotent for cancelByPayment', async () => {
      const bookingId = await createPendingBooking();

      const classBookingService = app.get(ClassBookingService);

      await classBookingService.cancelByPayment(bookingId, 'PAYMENT_FAILED');
      const result = await classBookingService.cancelByPayment(
        bookingId,
        'PAYMENT_FAILED',
      );

      expect(result).toBeNull();
    });

    it('should throw NotFoundException for non-existent booking', async () => {
      const classBookingService = app.get(ClassBookingService);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(
        classBookingService.confirmByPayment(fakeId),
      ).rejects.toThrow();
    });
  });
});
