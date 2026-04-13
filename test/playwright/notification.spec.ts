import { expect, test, type APIRequestContext } from '@playwright/test';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  cleanupTestData,
  createTestData,
  getNextDayOfWeek,
  type TestData,
} from '../test-helpers';
import {
  createApiContext,
  createStripeWebhookEvent,
  loginAs,
} from './api-helpers';

const prisma = new PrismaService();
const CHECKOUT_PRICE = 200_000;
const DEFAULT_CAPACITY = 5;

type NotificationListBody = {
  data: {
    docs: Array<{
      id: string;
      type: NotificationType;
      title: string;
      message: string;
      isRead: boolean;
      readAt: string | null;
      referenceId: string | null;
      createdAt: string;
    }>;
    totalDocs: number;
    totalPages: number;
  };
};

test.describe('Notification Playwright API E2E', () => {
  let testData: TestData;
  let anonymousApi: APIRequestContext;
  let memberApi: APIRequestContext;
  let adminApi: APIRequestContext;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await prisma.$connect();
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);
    await resetScheduleDefaults();

    anonymousApi = await createApiContext();
    memberApi = await createAuthenticatedContext(
      testData.memberUser.email,
      testData.memberPassword,
    );
    adminApi = await createAuthenticatedContext(
      testData.adminUser.email,
      testData.adminPassword,
    );
  });

  test.afterEach(async () => {
    await cleanupScenarioData();
  });

  test.afterAll(async () => {
    await cleanupScenarioData();
    await Promise.all([
      anonymousApi?.dispose(),
      memberApi?.dispose(),
      adminApi?.dispose(),
    ]);
    await cleanupTestData(prisma);
    await prisma.$disconnect();
  });

  async function createAuthenticatedContext(
    email: string,
    password: string,
  ): Promise<APIRequestContext> {
    const login = await loginAs(anonymousApi, email, password);
    return createApiContext(login.accessToken);
  }

  async function resetScheduleDefaults() {
    await prisma.classSchedule.update({
      where: { id: testData.testSchedule.id },
      data: {
        dayOfWeek: 'MON',
        capacity: DEFAULT_CAPACITY,
        isActive: true,
        price: CHECKOUT_PRICE,
        validFrom: null,
        validUntil: null,
      },
    });

    await prisma.trainerAvailability.deleteMany({
      where: { trainerId: testData.trainerUser.id },
    });
    await prisma.trainerAvailability.create({
      data: {
        trainerId: testData.trainerUser.id,
        dayOfWeek: 1,
        startTime: new Date('1970-01-01T10:00:00Z'),
        endTime: new Date('1970-01-01T11:00:00Z'),
        isAvailable: true,
      },
    });
  }

  async function cleanupScenarioData() {
    const knownUserIds = [
      testData.memberUser.id,
      testData.adminUser.id,
      testData.trainerUser.id,
    ];
    const bookings = await prisma.classBooking.findMany({
      where: {
        classScheduleId: testData.testSchedule.id,
      },
      select: { id: true },
    });
    const bookingIds = bookings.map((booking) => booking.id);

    if (bookingIds.length > 0) {
      await prisma.notification.deleteMany({
        where: {
          referenceId: {
            in: bookingIds,
          },
        },
      });
      await prisma.payment.deleteMany({
        where: {
          targetType: 'CLASS_BOOKING',
          targetId: {
            in: bookingIds,
          },
        },
      });
    }

    await prisma.notification.deleteMany({
      where: {
        userId: {
          in: knownUserIds,
        },
      },
    });
    await prisma.classBooking.deleteMany({
      where: {
        classScheduleId: testData.testSchedule.id,
      },
    });

    await resetScheduleDefaults();
  }

  async function createNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    isRead?: boolean;
    readAt?: Date | null;
    createdAt?: Date;
    referenceId?: string | null;
  }) {
    return prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        isRead: params.isRead ?? false,
        readAt: params.readAt,
        createdAt: params.createdAt,
        referenceId: params.referenceId ?? undefined,
      },
    });
  }

  async function createPendingBooking() {
    const bookingDate = getNextDayOfWeek('MON');
    return prisma.classBooking.create({
      data: {
        userId: testData.memberUser.id,
        classScheduleId: testData.testSchedule.id,
        bookingStartDate: bookingDate,
        bookingEndDate: addDays(bookingDate, 1),
        status: 'pending',
      },
    });
  }

  async function findLatestBookingPayment(bookingId: string) {
    return prisma.payment.findFirst({
      where: {
        targetType: 'CLASS_BOOKING',
        targetId: bookingId,
      },
      orderBy: { createdAt: 'desc' },
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

  test('requires authentication for notification routes', async () => {
    const unreadCountResponse = await anonymousApi.get('notifications/unread-count');
    const listResponse = await anonymousApi.get('notifications');
    const readAllResponse = await anonymousApi.patch('notifications/read-all');

    expect(unreadCountResponse.status()).toBe(401);
    expect(listResponse.status()).toBe(401);
    expect(readAllResponse.status()).toBe(401);
  });

  test('returns only the current user unread count', async () => {
    await Promise.all([
      createNotification({
        userId: testData.memberUser.id,
        type: NotificationType.PAYMENT,
        title: 'Member unread',
        message: 'Unread for member',
      }),
      createNotification({
        userId: testData.memberUser.id,
        type: NotificationType.BOOKING,
        title: 'Member read',
        message: 'Already read for member',
        isRead: true,
        readAt: new Date(),
      }),
      createNotification({
        userId: testData.adminUser.id,
        type: NotificationType.SYSTEM,
        title: 'Admin unread',
        message: 'Unread for admin',
      }),
    ]);

    const response = await memberApi.get('notifications/unread-count');

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { count: 1 },
    });
  });

  test('lists notifications in newest-first order with pagination and unread filtering', async () => {
    const oldest = await createNotification({
      userId: testData.memberUser.id,
      type: NotificationType.SYSTEM,
      title: 'Oldest',
      message: 'oldest message',
      createdAt: new Date('2026-03-01T08:00:00.000Z'),
    });
    const middle = await createNotification({
      userId: testData.memberUser.id,
      type: NotificationType.BOOKING,
      title: 'Middle',
      message: 'middle message',
      createdAt: new Date('2026-03-02T08:00:00.000Z'),
      isRead: true,
      readAt: new Date('2026-03-02T09:00:00.000Z'),
    });
    const newest = await createNotification({
      userId: testData.memberUser.id,
      type: NotificationType.PAYMENT,
      title: 'Newest',
      message: 'newest message',
      createdAt: new Date('2026-03-03T08:00:00.000Z'),
    });
    await createNotification({
      userId: testData.adminUser.id,
      type: NotificationType.SYSTEM,
      title: 'Admin hidden',
      message: 'should not leak',
      createdAt: new Date('2026-03-04T08:00:00.000Z'),
    });

    const firstPageResponse = await memberApi.get('notifications?page=1&limit=2');
    expect(firstPageResponse.status()).toBe(200);
    const firstPageBody =
      ((await firstPageResponse.json()) as NotificationListBody).data;

    expect(firstPageBody.docs.map((item) => item.id)).toEqual([
      newest.id,
      middle.id,
    ]);
    expect(firstPageBody.totalDocs).toBe(3);
    expect(firstPageBody.totalPages).toBe(2);

    const secondPageResponse = await memberApi.get('notifications?page=2&limit=2');
    expect(secondPageResponse.status()).toBe(200);
    const secondPageBody =
      ((await secondPageResponse.json()) as NotificationListBody).data;

    expect(secondPageBody.docs.map((item) => item.id)).toEqual([oldest.id]);
    expect(secondPageBody.totalDocs).toBe(3);

    const unreadOnlyResponse = await memberApi.get(
      'notifications?page=1&limit=10&unreadOnly=true',
    );
    expect(unreadOnlyResponse.status()).toBe(200);
    const unreadOnlyBody =
      ((await unreadOnlyResponse.json()) as NotificationListBody).data;

    expect(unreadOnlyBody.docs.map((item) => item.id)).toEqual([
      newest.id,
      oldest.id,
    ]);
    expect(unreadOnlyBody.totalDocs).toBe(2);
  });

  test('marks a single notification as read and safely no-ops when it is already read', async () => {
    const unread = await createNotification({
      userId: testData.memberUser.id,
      type: NotificationType.PAYMENT,
      title: 'Payment failed',
      message: 'Please update payment',
    });

    const firstResponse = await memberApi.patch(`notifications/${unread.id}/read`);
    expect(firstResponse.status()).toBe(200);
    const firstBody = (await firstResponse.json()) as {
      data: { id: string; isRead: boolean; readAt: string | null };
    };

    expect(firstBody.data.id).toBe(unread.id);
    expect(firstBody.data.isRead).toBe(true);
    expect(firstBody.data.readAt).toBeTruthy();

    const firstReadAt = firstBody.data.readAt;
    const secondResponse = await memberApi.patch(`notifications/${unread.id}/read`);
    expect(secondResponse.status()).toBe(200);
    const secondBody = (await secondResponse.json()) as {
      data: { id: string; isRead: boolean; readAt: string | null };
    };

    expect(secondBody.data).toMatchObject({
      id: unread.id,
      isRead: true,
      readAt: firstReadAt,
    });

    const unreadCountResponse = await memberApi.get('notifications/unread-count');
    expect(unreadCountResponse.status()).toBe(200);
    await expect(unreadCountResponse.json()).resolves.toMatchObject({
      data: { count: 0 },
    });
  });

  test('rejects invalid notification ids and cross-user read attempts', async () => {
    const notification = await createNotification({
      userId: testData.memberUser.id,
      type: NotificationType.BOOKING,
      title: 'Private booking update',
      message: 'Member only',
    });

    const invalidIdResponse = await memberApi.patch(
      'notifications/not-a-uuid/read',
    );
    expect(invalidIdResponse.status()).toBe(400);

    const crossUserResponse = await adminApi.patch(
      `notifications/${notification.id}/read`,
    );
    expect(crossUserResponse.status()).toBe(404);
  });

  test('marks all unread notifications as read only for the current user and stays idempotent', async () => {
    await Promise.all([
      createNotification({
        userId: testData.memberUser.id,
        type: NotificationType.PAYMENT,
        title: 'Unread 1',
        message: 'member unread 1',
      }),
      createNotification({
        userId: testData.memberUser.id,
        type: NotificationType.BOOKING,
        title: 'Unread 2',
        message: 'member unread 2',
      }),
      createNotification({
        userId: testData.memberUser.id,
        type: NotificationType.SYSTEM,
        title: 'Already read',
        message: 'member read',
        isRead: true,
        readAt: new Date(),
      }),
      createNotification({
        userId: testData.adminUser.id,
        type: NotificationType.SYSTEM,
        title: 'Admin unread',
        message: 'admin unread',
      }),
    ]);

    const firstResponse = await memberApi.patch('notifications/read-all');
    expect(firstResponse.status()).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      data: { updatedCount: 2 },
    });

    const [memberUnreadCount, adminUnreadCount] = await Promise.all([
      prisma.notification.count({
        where: {
          userId: testData.memberUser.id,
          isRead: false,
        },
      }),
      prisma.notification.count({
        where: {
          userId: testData.adminUser.id,
          isRead: false,
        },
      }),
    ]);

    expect(memberUnreadCount).toBe(0);
    expect(adminUnreadCount).toBe(1);

    const secondResponse = await memberApi.patch('notifications/read-all');
    expect(secondResponse.status()).toBe(200);
    await expect(secondResponse.json()).resolves.toMatchObject({
      data: { updatedCount: 0 },
    });
  });

  test('surfaces payment-failure notifications through the API and suppresses duplicate failure events', async () => {
    const booking = await createPendingBooking();

    const checkoutResponse = await memberApi.post(`class-booking/${booking.id}/checkout`);
    expect(checkoutResponse.status()).toBe(201);

    const payment = await findLatestBookingPayment(booking.id);
    expect(payment).not.toBeNull();

    const failureEvent = {
      id: `evt_notification_failure_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: `pi_notification_failure_${Date.now()}`,
          metadata: {
            paymentId: payment!.id,
          },
        },
      },
    };

    await triggerStripeWebhook(failureEvent);

    await expect
      .poll(
        async () =>
          prisma.notification.count({
            where: {
              userId: testData.memberUser.id,
              referenceId: booking.id,
            },
          }),
        { timeout: 10_000 },
      )
      .toBe(1);

    const unreadCountResponse = await memberApi.get('notifications/unread-count');
    expect(unreadCountResponse.status()).toBe(200);
    await expect(unreadCountResponse.json()).resolves.toMatchObject({
      data: { count: 1 },
    });

    const listResponse = await memberApi.get('notifications?unreadOnly=true');
    expect(listResponse.status()).toBe(200);
    const listBody = ((await listResponse.json()) as NotificationListBody).data;
    const paymentNotification = listBody.docs.find(
      (item) => item.referenceId === booking.id,
    );

    expect(paymentNotification).toMatchObject({
      type: NotificationType.PAYMENT,
      isRead: false,
      referenceId: booking.id,
    });

    await triggerStripeWebhook(failureEvent);

    await expect
      .poll(
        async () =>
          prisma.notification.count({
            where: {
              userId: testData.memberUser.id,
              referenceId: booking.id,
            },
          }),
        { timeout: 10_000 },
      )
      .toBe(1);
  });
});
