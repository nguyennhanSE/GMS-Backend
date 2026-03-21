import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  TestData,
  authRequest,
  cleanupTestData,
  createTestData,
  loginAs,
} from './test-helpers';

describe('Notifications API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testData: TestData;
  let memberToken: string;
  let adminToken: string;

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

    await cleanupNotificationTestData();
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);

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
  }, 60000);

  afterEach(async () => {
    await cleanupNotificationTestData();
  });

  afterAll(async () => {
    await cleanupNotificationTestData();
    await cleanupTestData(prisma);
    await app.close();
  });

  async function cleanupNotificationTestData() {
    if (!prisma || !testData) {
      return;
    }

    await prisma.notification.deleteMany({
      where: {
        userId: {
          in: [
            testData.memberUser.id,
            testData.adminUser.id,
            testData.trainerUser.id,
          ],
        },
      },
    });
  }

  async function seedNotifications() {
    const memberUnread = await prisma.notification.create({
      data: {
        userId: testData.memberUser.id,
        type: NotificationType.PAYMENT,
        title: 'Payment failed',
        message: 'Update your card',
        referenceId: testData.testSchedule.id,
      },
    });

    const memberRead = await prisma.notification.create({
      data: {
        userId: testData.memberUser.id,
        type: NotificationType.BOOKING,
        title: 'Class cancelled',
        message: 'Class was cancelled',
        referenceId: testData.testSchedule.id,
        isRead: true,
        readAt: new Date(),
      },
    });

    await prisma.notification.create({
      data: {
        userId: testData.adminUser.id,
        type: NotificationType.SYSTEM,
        title: 'Admin only',
        message: 'Do not leak',
      },
    });

    return { memberUnread, memberRead };
  }

  it('returns only the current user unread count', async () => {
    await seedNotifications();

    const response = await authRequest(app, memberToken).get(
      '/notifications/unread-count',
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ count: 1 });
  });

  it('lists only the current user notifications and supports unreadOnly filtering', async () => {
    const { memberUnread } = await seedNotifications();

    const response = await authRequest(app, memberToken).get(
      '/notifications?page=1&limit=10&unreadOnly=true',
    );

    expect(response.status).toBe(200);
    expect(response.body.data.docs).toHaveLength(1);
    expect(response.body.data.docs[0].id).toBe(memberUnread.id);
    expect(response.body.data.totalDocs).toBe(1);
  });

  it('marks a single notification as read for the current user', async () => {
    const { memberUnread } = await seedNotifications();

    const response = await authRequest(app, memberToken).patch(
      `/notifications/${memberUnread.id}/read`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.isRead).toBe(true);

    const updated = await prisma.notification.findUnique({
      where: { id: memberUnread.id },
    });
    expect(updated?.isRead).toBe(true);
    expect(updated?.readAt).not.toBeNull();
  });

  it('does not allow another authenticated user to mark someone else notification as read', async () => {
    const { memberUnread } = await seedNotifications();

    const response = await authRequest(app, adminToken).patch(
      `/notifications/${memberUnread.id}/read`,
    );

    expect(response.status).toBe(404);
  });

  it('marks all unread notifications as read for the current user only', async () => {
    await seedNotifications();

    const response = await authRequest(app, memberToken).patch(
      '/notifications/read-all',
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ updatedCount: 1 });

    const memberUnreadCount = await prisma.notification.count({
      where: { userId: testData.memberUser.id, isRead: false },
    });
    const adminUnreadCount = await prisma.notification.count({
      where: { userId: testData.adminUser.id, isRead: false },
    });

    expect(memberUnreadCount).toBe(0);
    expect(adminUnreadCount).toBe(1);
  });
});
