import { expect, test, type APIRequestContext } from '@playwright/test';
import { PaymentStatus, TrainerBookingStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createApiContext,
  createStripeWebhookEvent,
  loginAs,
} from './api-helpers';

type TestUser = {
  id: string;
  email: string;
  password: string;
};

const prisma = new PrismaService();
const TEST_PASSWORD = 'PlaywrightPayment@123';
const suitePrefix = 'playwright-payment-module';
const suiteKey = `${suitePrefix}-${Date.now()}`;
const TRAINER_BOOKING_PRICE = 350_000;
const TRAINER_BOOKING_CURRENCY = 'VND';
const PAYMENT_FAILED_TITLE = 'Payment failed';

test.describe('Payment Module Playwright API E2E', () => {
  let anonymousApi: APIRequestContext;
  let memberApi: APIRequestContext;
  let otherMemberApi: APIRequestContext;

  let memberUser: TestUser;
  let otherMemberUser: TestUser;
  let trainerUser: TestUser;

  test.beforeAll(async () => {
    await prisma.$connect();
    await cleanupSuiteState();
    await setupBaseFixtures();

    anonymousApi = await createApiContext();
    memberApi = await createAuthenticatedContext(memberUser);
    otherMemberApi = await createAuthenticatedContext(otherMemberUser);
  });

  test.afterEach(async () => {
    await waitForAsyncEventHandlers();
    await clearPerTestState();
  });

  test.afterAll(async () => {
    await waitForAsyncEventHandlers();
    await Promise.all([
      anonymousApi?.dispose(),
      memberApi?.dispose(),
      otherMemberApi?.dispose(),
    ]);
    await cleanupSuiteState();
    await prisma.$disconnect();
  });

  async function createAuthenticatedContext(
    user: TestUser,
  ): Promise<APIRequestContext> {
    const login = await loginAs(anonymousApi, user.email, user.password);
    return createApiContext(login.accessToken);
  }

  async function setupBaseFixtures() {
    const hashedPassword = String(await bcrypt.hash(TEST_PASSWORD, 10));
    const [memberRole, trainerRole] = await Promise.all([
      ensureRole('MEMBER'),
      ensureRole('TRAINER'),
    ]);

    memberUser = await createUser(
      `${suiteKey}-member@test.local`,
      'Member',
      memberRole.id,
      hashedPassword,
    );
    otherMemberUser = await createUser(
      `${suiteKey}-other-member@test.local`,
      'Other Member',
      memberRole.id,
      hashedPassword,
    );
    trainerUser = await createUser(
      `${suiteKey}-trainer@test.local`,
      'Trainer',
      trainerRole.id,
      hashedPassword,
    );
  }

  async function ensureRole(name: string): Promise<{ id: string }> {
    return prisma.role.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${name} role`,
      },
    });
  }

  async function createUser(
    email: string,
    label: string,
    roleId: string,
    passwordHash: string,
  ): Promise<TestUser> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Playwright',
        lastName: label,
        email,
        password: passwordHash,
        status: 'active',
        userRole: {
          create: {
            roleId,
          },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      password: TEST_PASSWORD,
    };
  }

  function createSlot(options?: {
    startsInMinutes?: number;
    durationMinutes?: number;
  }) {
    const startAt = new Date(
      Date.now() + (options?.startsInMinutes ?? 48 * 60) * 60 * 1000,
    );
    startAt.setSeconds(0, 0);
    const endAt = new Date(
      startAt.getTime() + (options?.durationMinutes ?? 60) * 60 * 1000,
    );

    return { startAt, endAt };
  }

  async function createAcceptedTrainerBooking(options?: {
    memberId?: string;
    startAt?: Date;
    endAt?: Date;
  }) {
    const defaultSlot = createSlot();
    const slot = {
      startAt: options?.startAt ?? defaultSlot.startAt,
      endAt: options?.endAt ?? defaultSlot.endAt,
    };

    return prisma.trainerBooking.create({
      data: {
        memberId: options?.memberId ?? memberUser.id,
        trainerId: trainerUser.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
        price: TRAINER_BOOKING_PRICE,
        currency: TRAINER_BOOKING_CURRENCY,
      },
    });
  }

  async function requestTrainerBookingCheckout(
    api: APIRequestContext,
    bookingId: string,
  ) {
    return api.post('payments/checkout', {
      data: {
        targetType: 'TRAINER_BOOKING',
        targetId: bookingId,
      },
    });
  }

  function extractCheckoutUrl(body: {
    data?: { checkoutUrl?: string };
    checkoutUrl?: string;
  }) {
    return body.data?.checkoutUrl ?? body.checkoutUrl ?? '';
  }

  async function getLatestTrainerBookingPayment(bookingId: string) {
    return prisma.payment.findFirst({
      where: {
        targetType: 'TRAINER_BOOKING',
        targetId: bookingId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async function listTrainerBookingPayments(bookingId: string) {
    return prisma.payment.findMany({
      where: {
        targetType: 'TRAINER_BOOKING',
        targetId: bookingId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async function triggerStripeWebhook(event: Record<string, unknown>) {
    const { body, signature } = createStripeWebhookEvent(event);
    const response = await anonymousApi.post('payments/webhook/stripe', {
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      data: body,
    });

    expect(response.status()).toBe(200);
  }

  async function countPaymentFailedNotifications(bookingId: string) {
    return prisma.notification.count({
      where: {
        referenceId: bookingId,
        title: PAYMENT_FAILED_TITLE,
        userId: {
          in: [memberUser.id, trainerUser.id],
        },
      },
    });
  }

  async function waitForAsyncEventHandlers() {
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  test('requires authentication for direct payment checkout', async () => {
    const booking = await createAcceptedTrainerBooking();

    const response = await requestTrainerBookingCheckout(anonymousApi, booking.id);

    expect(response.status()).toBe(401);
  });

  test("forbids checkout for another member's accepted trainer booking and derives the booking price for the owner", async () => {
    const booking = await createAcceptedTrainerBooking();

    const forbiddenResponse = await requestTrainerBookingCheckout(
      otherMemberApi,
      booking.id,
    );
    expect(forbiddenResponse.status()).toBe(403);

    const ownerResponse = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(ownerResponse.status()).toBe(201);

    const ownerBody = (await ownerResponse.json()) as {
      data?: { checkoutUrl?: string };
      checkoutUrl?: string;
    };
    expect(extractCheckoutUrl(ownerBody)).toContain('http');

    const payment = await getLatestTrainerBookingPayment(booking.id);
    expect(payment).not.toBeNull();
    expect(Number(payment?.amount)).toBe(TRAINER_BOOKING_PRICE);
    expect(payment?.currency).toBe(TRAINER_BOOKING_CURRENCY);
    expect(payment?.status).toBe(PaymentStatus.PENDING);
  });

  test('returns the same checkout URL while the trainer-booking payment is still fresh', async () => {
    const booking = await createAcceptedTrainerBooking();

    const firstResponse = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(firstResponse.status()).toBe(201);
    const firstBody = (await firstResponse.json()) as {
      data?: { checkoutUrl?: string };
      checkoutUrl?: string;
    };
    const firstCheckoutUrl = extractCheckoutUrl(firstBody);
    expect(firstCheckoutUrl).toContain('http');

    const secondResponse = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(secondResponse.status()).toBe(201);
    const secondBody = (await secondResponse.json()) as {
      data?: { checkoutUrl?: string };
      checkoutUrl?: string;
    };

    expect(extractCheckoutUrl(secondBody)).toBe(firstCheckoutUrl);
    expect((await listTrainerBookingPayments(booking.id)).length).toBe(1);
  });

  test('expires a stale pending payment and creates a fresh checkout session', async () => {
    const booking = await createAcceptedTrainerBooking();

    const stalePayment = await prisma.payment.create({
      data: {
        userId: memberUser.id,
        targetType: 'TRAINER_BOOKING',
        targetId: booking.id,
        amount: TRAINER_BOOKING_PRICE,
        currency: TRAINER_BOOKING_CURRENCY,
        status: 'PENDING',
        checkoutUrl: 'https://checkout.stripe.com/stale-payment',
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    });

    const response = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(response.status()).toBe(201);

    const body = (await response.json()) as {
      data?: { checkoutUrl?: string };
      checkoutUrl?: string;
    };
    const checkoutUrl = extractCheckoutUrl(body);
    expect(checkoutUrl).toContain('http');
    expect(checkoutUrl).not.toBe(stalePayment.checkoutUrl);

    const payments = await listTrainerBookingPayments(booking.id);
    expect(payments).toHaveLength(2);

    const [expiredPayment, freshPayment] = payments;
    expect(expiredPayment.id).toBe(stalePayment.id);
    expect(expiredPayment.status).toBe(PaymentStatus.FAILED);
    expect(expiredPayment.failureReason).toBe('SESSION_EXPIRED');
    expect(freshPayment.status).toBe(PaymentStatus.PENDING);
    expect(freshPayment.checkoutUrl).toBe(checkoutUrl);
  });

  test('expires the trainer booking when the member starts checkout after the payment window closed', async () => {
    const startAt = new Date(Date.now() - 5 * 60 * 1000);
    startAt.setSeconds(0, 0);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const booking = await createAcceptedTrainerBooking({
      startAt,
      endAt,
    });

    const response = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(JSON.stringify(body)).toContain('payment window expired');

    await expect
      .poll(
        async () =>
          prisma.trainerBooking.findUnique({
            where: { id: booking.id },
            select: {
              status: true,
              cancelReason: true,
            },
          }),
        { timeout: 10000 },
      )
      .toEqual({
        status: TrainerBookingStatus.EXPIRED,
        cancelReason: 'SESSION_EXPIRED',
      });

    expect(await getLatestTrainerBookingPayment(booking.id)).toBeNull();
  });

  test('rejects invalid Stripe webhook signatures without changing payment state', async () => {
    const booking = await createAcceptedTrainerBooking();
    const checkoutResponse = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(checkoutResponse.status()).toBe(201);

    const payment = await getLatestTrainerBookingPayment(booking.id);
    expect(payment?.providerSessionId).toBeTruthy();

    const response = await anonymousApi.post('payments/webhook/stripe', {
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-signature',
      },
      data: JSON.stringify({
        id: `evt_invalid_signature_${Date.now()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: payment!.providerSessionId,
            payment_intent: `pi_invalid_signature_${Date.now()}`,
          },
        },
      }),
    });

    expect(response.status()).toBe(401);

    const refreshedPayment = await getLatestTrainerBookingPayment(booking.id);
    expect(refreshedPayment?.status).toBe(PaymentStatus.PENDING);

    const refreshedBooking = await prisma.trainerBooking.findUnique({
      where: { id: booking.id },
      select: { status: true },
    });
    expect(refreshedBooking?.status).toBe(
      TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
    );
  });

  test('marks the payment failed and expires the booking on checkout.session.expired without sending failure notifications', async () => {
    const booking = await createAcceptedTrainerBooking();
    const checkoutResponse = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(checkoutResponse.status()).toBe(201);

    const payment = await getLatestTrainerBookingPayment(booking.id);
    expect(payment?.providerSessionId).toBeTruthy();

    await triggerStripeWebhook({
      id: `evt_session_expired_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: payment!.providerSessionId,
        },
      },
    });

    await expect
      .poll(
        async () =>
          prisma.payment.findUnique({
            where: { id: payment!.id },
            select: {
              status: true,
              failureReason: true,
            },
          }),
        { timeout: 10000 },
      )
      .toEqual({
        status: PaymentStatus.FAILED,
        failureReason: 'SESSION_EXPIRED',
      });

    await expect
      .poll(
        async () =>
          prisma.trainerBooking.findUnique({
            where: { id: booking.id },
            select: {
              status: true,
              cancelReason: true,
            },
          }),
        { timeout: 10000 },
      )
      .toEqual({
        status: TrainerBookingStatus.EXPIRED,
        cancelReason: 'SESSION_EXPIRED',
      });

    await expect
      .poll(() => countPaymentFailedNotifications(booking.id), {
        timeout: 10000,
      })
      .toBe(0);
  });

  test('resurrects the payment record to SUCCESS when a late checkout.session.completed arrives after session expiry', async () => {
    const booking = await createAcceptedTrainerBooking();
    const checkoutResponse = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(checkoutResponse.status()).toBe(201);

    const payment = await getLatestTrainerBookingPayment(booking.id);
    expect(payment?.providerSessionId).toBeTruthy();

    await triggerStripeWebhook({
      id: `evt_late_success_expired_first_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: payment!.providerSessionId,
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await prisma.payment.findUnique({
              where: { id: payment!.id },
              select: { status: true },
            })
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe(PaymentStatus.FAILED);

    const paymentIntentId = `pi_late_success_${Date.now()}`;
    await triggerStripeWebhook({
      id: `evt_late_success_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment!.providerSessionId,
          payment_intent: paymentIntentId,
        },
      },
    });

    await expect
      .poll(
        async () =>
          prisma.payment.findUnique({
            where: { id: payment!.id },
            select: {
              status: true,
              providerPaymentId: true,
            },
          }),
        { timeout: 10000 },
      )
      .toEqual({
        status: PaymentStatus.SUCCESS,
        providerPaymentId: paymentIntentId,
      });
  });

  test('marks a successful trainer-booking payment refunded and cancels the booking', async () => {
    const booking = await createAcceptedTrainerBooking();
    const checkoutResponse = await requestTrainerBookingCheckout(memberApi, booking.id);
    expect(checkoutResponse.status()).toBe(201);

    const payment = await getLatestTrainerBookingPayment(booking.id);
    expect(payment?.providerSessionId).toBeTruthy();

    const paymentIntentId = `pi_refund_${Date.now()}`;
    await triggerStripeWebhook({
      id: `evt_refund_success_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment!.providerSessionId,
          payment_intent: paymentIntentId,
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await prisma.trainerBooking.findUnique({
              where: { id: booking.id },
              select: { status: true },
            })
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe(TrainerBookingStatus.CONFIRMED);

    await triggerStripeWebhook({
      id: `evt_refund_${Date.now()}`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          payment_intent: paymentIntentId,
        },
      },
    });

    await expect
      .poll(
        async () =>
          prisma.payment.findUnique({
            where: { id: payment!.id },
            select: { status: true },
          }),
        { timeout: 10000 },
      )
      .toEqual({
        status: PaymentStatus.REFUNDED,
      });

    await expect
      .poll(
        async () =>
          prisma.trainerBooking.findUnique({
            where: { id: booking.id },
            select: {
              status: true,
              cancelReason: true,
            },
          }),
        { timeout: 10000 },
      )
      .toEqual({
        status: TrainerBookingStatus.CANCELLED,
        cancelReason: 'PAYMENT_REFUNDED',
      });
  });

  async function clearPerTestState() {
    const userIds = [memberUser.id, otherMemberUser.id, trainerUser.id].filter(
      Boolean,
    );

    if (userIds.length === 0) {
      return;
    }

    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.trainerBooking.deleteMany({
      where: {
        OR: [
          { memberId: { in: userIds } },
          { trainerId: { in: userIds } },
        ],
      },
    });
    await prisma.payment.deleteMany({
      where: {
        userId: { in: userIds },
      },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: userIds } },
    });
  }

  async function cleanupSuiteState() {
    const existingUsers = await prisma.user.findMany({
      where: {
        email: {
          startsWith: suitePrefix,
        },
      },
      select: { id: true },
    });
    const userIds = existingUsers.map((user) => user.id);

    if (userIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.trainerBooking.deleteMany({
        where: {
          OR: [
            { memberId: { in: userIds } },
            { trainerId: { in: userIds } },
          ],
        },
      });
      await prisma.payment.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.session.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  }
});
