import { expect, test, type APIRequestContext } from '@playwright/test';
import bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  cleanupTestData,
  createTestData,
  formatDate,
  getErrorMessage,
  getNextDayOfWeek,
  type TestData,
} from '../test-helpers';
import {
  createApiContext,
  createStripeWebhookEvent,
  loginAs,
} from './api-helpers';

const prisma = new PrismaService();
const DEFAULT_PRICE = 200_000;
const DEFAULT_CAPACITY = 5;
const TEMP_USER_PREFIX = 'playwright-class-booking-temp-';
const STAFF_EMAIL = 'api-test-staff@test.local';
const STAFF_PASSWORD = 'Test@12345';

test.describe('Class Booking Playwright API E2E', () => {
  let testData: TestData;
  let staffUserId: string;
  let anonymousApi: APIRequestContext;
  let adminApi: APIRequestContext;
  let memberApi: APIRequestContext;
  let trainerApi: APIRequestContext;
  let staffApi: APIRequestContext;

  test.beforeAll(async () => {
    await prisma.$connect();
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);
    await resetScheduleDefaults();

    anonymousApi = await createApiContext();
    adminApi = await createAuthenticatedContext(
      testData.adminUser.email,
      testData.adminPassword,
    );
    memberApi = await createAuthenticatedContext(
      testData.memberUser.email,
      testData.memberPassword,
    );
    trainerApi = await createAuthenticatedContext(
      testData.trainerUser.email,
      testData.trainerPassword,
    );
    staffUserId = await ensureStaffUser();
    staffApi = await createAuthenticatedContext(STAFF_EMAIL, STAFF_PASSWORD);
  });

  test.afterEach(async () => {
    await cleanupScenarioData();
  });

  test.afterAll(async () => {
    await cleanupScenarioData();
    await Promise.all([
      anonymousApi?.dispose(),
      adminApi?.dispose(),
      memberApi?.dispose(),
      trainerApi?.dispose(),
      staffApi?.dispose(),
    ]);
    await cleanupStaffUser();
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
        price: DEFAULT_PRICE,
        validFrom: null,
        validUntil: null,
      },
    });
    await resetTrainerAvailability();
  }

  async function resetTrainerAvailability() {
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

  async function ensureStaffUser() {
    const passwordHash = await bcrypt.hash(STAFF_PASSWORD, 10);
    const staffRole = await prisma.role.upsert({
      where: { name: 'STAFF' },
      update: {},
      create: {
        name: 'STAFF',
        description: 'Staff role',
      },
    });

    const existingStaff = await prisma.user.findUnique({
      where: { email: STAFF_EMAIL },
    });

    if (existingStaff) {
      await prisma.user.update({
        where: { id: existingStaff.id },
        data: {
          password: passwordHash,
          status: 'active',
        },
      });

      const existingUserRole = await prisma.userRole.findFirst({
        where: {
          userId: existingStaff.id,
          roleId: staffRole.id,
        },
      });

      if (!existingUserRole) {
        await prisma.userRole.create({
          data: {
            userId: existingStaff.id,
            roleId: staffRole.id,
          },
        });
      }

      return existingStaff.id;
    }

    const staffUser = await prisma.user.create({
      data: {
        firstName: 'API Test',
        lastName: 'Staff',
        email: STAFF_EMAIL,
        password: passwordHash,
        status: 'active',
        userRole: {
          create: {
            roleId: staffRole.id,
          },
        },
      },
    });

    return staffUser.id;
  }

  async function cleanupStaffUser() {
    const existingStaff = await prisma.user.findUnique({
      where: { email: STAFF_EMAIL },
      select: { id: true },
    });

    if (!existingStaff) {
      return;
    }

    await prisma.notification.deleteMany({
      where: { userId: existingStaff.id },
    });
    await prisma.payment.deleteMany({
      where: { userId: existingStaff.id },
    });
    await prisma.session.deleteMany({
      where: { userId: existingStaff.id },
    });
    await prisma.userRole.deleteMany({
      where: { userId: existingStaff.id },
    });
    await prisma.user.delete({
      where: { id: existingStaff.id },
    });
  }

  async function cleanupScenarioData() {
    const allSchedules = await prisma.classSchedule.findMany({
      where: {
        classId: testData.testClass.id,
      },
      select: { id: true },
    });
    const allScheduleIds = allSchedules.map((schedule) => schedule.id);

    const bookings = await prisma.classBooking.findMany({
      where: {
        classScheduleId: {
          in: allScheduleIds,
        },
      },
      select: { id: true },
    });
    const bookingIds = bookings.map((booking) => booking.id);

    const tempUsers = await prisma.user.findMany({
      where: {
        email: {
          startsWith: TEMP_USER_PREFIX,
        },
      },
      select: { id: true },
    });
    const tempUserIds = tempUsers.map((user) => user.id);
    const knownUserIds = [
      testData.adminUser.id,
      testData.memberUser.id,
      testData.trainerUser.id,
      staffUserId,
      ...tempUserIds,
    ].filter((userId): userId is string => Boolean(userId));

    if (bookingIds.length > 0) {
      await prisma.notification.deleteMany({
        where: {
          referenceId: { in: bookingIds },
        },
      });

      await prisma.payment.deleteMany({
        where: {
          targetType: 'CLASS_BOOKING',
          targetId: { in: bookingIds },
        },
      });
    }

    await prisma.notification.deleteMany({
      where: {
        userId: { in: knownUserIds },
      },
    });

    await prisma.payment.deleteMany({
      where: {
        targetType: 'CLASS_BOOKING',
        userId: { in: knownUserIds },
      },
    });

    await prisma.classBooking.deleteMany({
      where: {
        classScheduleId: {
          in: allScheduleIds,
        },
      },
    });
    await prisma.scheduleException.deleteMany({
      where: {
        scheduleId: {
          in: allScheduleIds,
        },
      },
    });
    await prisma.scheduleDay.deleteMany({
      where: {
        scheduleId: {
          in: allScheduleIds.filter((id) => id !== testData.testSchedule.id),
        },
      },
    });
    await prisma.classSchedule.deleteMany({
      where: {
        id: {
          in: allScheduleIds.filter((id) => id !== testData.testSchedule.id),
        },
      },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: tempUserIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: tempUserIds } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: TEMP_USER_PREFIX,
        },
      },
    });

    await resetScheduleDefaults();
  }

  function buildBookingPayload(userId: string, bookingDate: Date) {
    return {
      userId,
      classScheduleId: [testData.testSchedule.id],
      bookingStartDate: formatDate(bookingDate),
      bookingEndDate: formatDate(addDays(bookingDate, 1)),
    };
  }

  async function createBookingThroughApi(
    userId: string,
    bookingDate: Date,
    api: APIRequestContext = adminApi,
  ) {
    return api.post('class-booking/create', {
      data: buildBookingPayload(userId, bookingDate),
    });
  }

  async function createBookingDirect(params?: {
    userId?: string;
    bookingDate?: Date;
    status?: string;
  }) {
    const bookingDate = params?.bookingDate ?? getNextDayOfWeek('MON');
    return prisma.classBooking.create({
      data: {
        userId: params?.userId ?? testData.memberUser.id,
        classScheduleId: testData.testSchedule.id,
        bookingStartDate: bookingDate,
        bookingEndDate: addDays(bookingDate, 1),
        status: params?.status ?? 'pending',
      },
    });
  }

  async function createTempUser(label: string) {
    return prisma.user.create({
      data: {
        firstName: 'Playwright',
        lastName: label,
        email: `${TEMP_USER_PREFIX}${label}-${Date.now()}@test.local`,
        password: 'dummy',
        status: 'active',
      },
    });
  }

  async function createAdditionalSchedule(overrides?: {
    dayOfWeek?: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
    startTime?: Date;
    endTime?: Date;
    capacity?: number;
    price?: number;
    isActive?: boolean;
    validFrom?: Date | null;
    validUntil?: Date | null;
  }) {
    return prisma.classSchedule.create({
      data: {
        classId: testData.testClass.id,
        trainerId: testData.trainerUser.id,
        dayOfWeek: overrides?.dayOfWeek ?? 'MON',
        startTime:
          overrides?.startTime ?? new Date('1970-01-01T10:00:00Z'),
        endTime: overrides?.endTime ?? new Date('1970-01-01T11:00:00Z'),
        capacity: overrides?.capacity ?? DEFAULT_CAPACITY,
        isActive: overrides?.isActive ?? true,
        location: `Playwright Extra Schedule ${Date.now()}`,
        validFrom: overrides?.validFrom ?? null,
        validUntil: overrides?.validUntil ?? null,
        price: overrides?.price ?? DEFAULT_PRICE,
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

  async function countBookingPayments(bookingId: string) {
    return prisma.payment.count({
      where: {
        targetType: 'CLASS_BOOKING',
        targetId: bookingId,
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

  test.describe('Create and Validate Bookings', () => {
    test('allows an admin to create a booking', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );

      expect(response.status()).toBe(201);

      const body = (await response.json()) as {
        data: Array<{ id: string; status: string; userId: string }>;
      };

      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe('pending');
      expect(body.data[0].userId).toBe(testData.memberUser.id);
    });

    test('forbids members from creating bookings', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
        memberApi,
      );

      expect(response.status()).toBe(403);
    });

    test('rejects bookings on the wrong day of week', async () => {
      const nextTuesday = getNextDayOfWeek('TUE');
      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextTuesday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('scheduled for');
    });

    test('rejects trainer self-booking', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const response = await createBookingThroughApi(
        testData.trainerUser.id,
        nextMonday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('cannot book their own');
    });

    test('rejects booking on a cancelled exception date', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      await prisma.scheduleException.create({
        data: {
          scheduleId: testData.testSchedule.id,
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'Holiday closure',
        },
      });

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('cancelled');
    });

    test('rejects booking on a rescheduled exception date', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      await prisma.scheduleException.create({
        data: {
          scheduleId: testData.testSchedule.id,
          exceptionDate: nextMonday,
          type: 'RESCHEDULED',
          newStartTime: new Date('1970-01-01T12:00:00Z'),
          newEndTime: new Date('1970-01-01T13:00:00Z'),
        },
      });

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('rescheduled');
    });

    test('rejects booking when the date is already at capacity', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      for (let index = 0; index < DEFAULT_CAPACITY; index += 1) {
        const tempUser = await createTempUser(`full-${index}`);
        await createBookingDirect({
          userId: tempUser.id,
          bookingDate: nextMonday,
          status: 'confirmed',
        });
      }

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('full');
    });

    test('rejects invalid date ranges where the booking end date is not after the start date', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const response = await adminApi.post('class-booking/create', {
        data: {
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(nextMonday),
        },
      });
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain(
        'Booking start date must be before end date',
      );
    });

    test('rejects missing schedules', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const response = await adminApi.post('class-booking/create', {
        data: {
          userId: testData.memberUser.id,
          classScheduleId: ['00000000-0000-0000-0000-000000000000'],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        },
      });

      expect(response.status()).toBe(404);
    });

    test('rejects inactive schedules', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      await prisma.classSchedule.update({
        where: { id: testData.testSchedule.id },
        data: { isActive: false },
      });

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('not currently active or valid');
    });

    test('rejects schedules that are outside their valid date range', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      await prisma.classSchedule.update({
        where: { id: testData.testSchedule.id },
        data: {
          validFrom: addDays(new Date(), 30),
          validUntil: null,
        },
      });

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('not currently active or valid');
    });

    test('rejects trainer availability conflicts', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      await prisma.trainerAvailability.deleteMany({
        where: { trainerId: testData.trainerUser.id },
      });
      await prisma.trainerAvailability.create({
        data: {
          trainerId: testData.trainerUser.id,
          dayOfWeek: 1,
          startTime: new Date('1970-01-01T12:00:00Z'),
          endTime: new Date('1970-01-01T13:00:00Z'),
          isAvailable: true,
        },
      });

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      const body = await response.json();

      expect(response.status()).toBe(400);
      expect(getErrorMessage(body)).toContain('Trainer is not available');
    });

    test('creates bookings for multiple schedule ids in a single batch request', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const secondSchedule = await createAdditionalSchedule();

      const response = await adminApi.post('class-booking/create', {
        data: {
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id, secondSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        },
      });

      expect(response.status()).toBe(201);

      const body = (await response.json()) as {
        data: Array<{ classScheduleId: string }>;
      };

      expect(body.data).toHaveLength(2);
      expect(body.data.map((item) => item.classScheduleId).sort()).toEqual(
        [testData.testSchedule.id, secondSchedule.id].sort(),
      );
    });

    test('rolls back the whole batch when one schedule in the request is invalid', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const secondSchedule = await createAdditionalSchedule();

      const response = await adminApi.post('class-booking/create', {
        data: {
          userId: testData.memberUser.id,
          classScheduleId: [
            secondSchedule.id,
            '00000000-0000-0000-0000-000000000000',
          ],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        },
      });

      expect(response.status()).toBe(404);

      const createdBookings = await prisma.classBooking.findMany({
        where: {
          userId: testData.memberUser.id,
          classScheduleId: {
            in: [secondSchedule.id],
          },
        },
      });

      expect(createdBookings).toHaveLength(0);
    });
  });

  test.describe('Read and Manage Bookings', () => {
    test('returns the current member bookings and rejects unauthenticated access', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const booking = await createBookingDirect({
        userId: testData.memberUser.id,
        bookingDate: nextMonday,
        status: 'confirmed',
      });

      const memberResponse = await memberApi.get('class-booking/my-bookings');
      expect(memberResponse.status()).toBe(200);

      const memberBody = (await memberResponse.json()) as {
        data: Array<{ id: string }>;
      };

      expect(memberBody.data.some((item) => item.id === booking.id)).toBe(true);

      const anonymousResponse = await anonymousApi.get(
        'class-booking/my-bookings',
      );
      expect(anonymousResponse.status()).toBe(401);
    });

    test('lets admins retrieve bookings through list, by-user, by-schedule, and by-id endpoints', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const booking = await createBookingDirect({
        userId: testData.memberUser.id,
        bookingDate: nextMonday,
        status: 'confirmed',
      });

      const listResponse = await adminApi.get(
        `class-booking/list?userId=${testData.memberUser.id}&classScheduleId=${testData.testSchedule.id}&status=confirmed&q=Integration&limit=10&page=1&counted=true`,
      );
      expect(listResponse.status()).toBe(200);
      const listBody = (await listResponse.json()) as {
        data: { docs: Array<{ id: string }> };
      };
      expect(listBody.data.docs.some((item) => item.id === booking.id)).toBe(
        true,
      );

      const byUserResponse = await adminApi.get(
        `class-booking/user/${testData.memberUser.id}`,
      );
      expect(byUserResponse.status()).toBe(200);
      const byUserBody = (await byUserResponse.json()) as {
        data: Array<{ id: string }>;
      };
      expect(byUserBody.data.some((item) => item.id === booking.id)).toBe(true);

      const byScheduleResponse = await adminApi.get(
        `class-booking/class-schedule/${testData.testSchedule.id}`,
      );
      expect(byScheduleResponse.status()).toBe(200);
      const byScheduleBody = (await byScheduleResponse.json()) as {
        data: Array<{ id: string }>;
      };
      expect(
        byScheduleBody.data.some((item) => item.id === booking.id),
      ).toBe(true);

      const byIdResponse = await adminApi.get(`class-booking/${booking.id}`);
      expect(byIdResponse.status()).toBe(200);
      const byIdBody = (await byIdResponse.json()) as {
        data: { id: string; status: string };
      };
      expect(byIdBody.data.id).toBe(booking.id);
      expect(byIdBody.data.status).toBe('confirmed');
    });

    test('forbids members from listing bookings', async () => {
      const response = await memberApi.get('class-booking/list');
      expect(response.status()).toBe(403);
    });

    test('allows trainer, staff, and admin to access my-bookings', async () => {
      const memberResponse = await memberApi.get('class-booking/my-bookings');
      const trainerResponse = await trainerApi.get('class-booking/my-bookings');
      const staffResponse = await staffApi.get('class-booking/my-bookings');
      const adminResponse = await adminApi.get('class-booking/my-bookings');

      expect(memberResponse.status()).toBe(200);
      expect(trainerResponse.status()).toBe(200);
      expect(staffResponse.status()).toBe(200);
      expect(adminResponse.status()).toBe(200);
    });

    test('allows staff to use booking admin reads and forbids trainer access to those routes', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const booking = await createBookingDirect({
        userId: testData.memberUser.id,
        bookingDate: nextMonday,
        status: 'confirmed',
      });

      const staffList = await staffApi.get('class-booking/list');
      const staffById = await staffApi.get(`class-booking/${booking.id}`);
      const staffByUser = await staffApi.get(
        `class-booking/user/${testData.memberUser.id}`,
      );
      const staffBySchedule = await staffApi.get(
        `class-booking/class-schedule/${testData.testSchedule.id}`,
      );

      expect(staffList.status()).toBe(200);
      expect(staffById.status()).toBe(200);
      expect(staffByUser.status()).toBe(200);
      expect(staffBySchedule.status()).toBe(200);

      const trainerList = await trainerApi.get('class-booking/list');
      const trainerById = await trainerApi.get(`class-booking/${booking.id}`);
      const trainerByUser = await trainerApi.get(
        `class-booking/user/${testData.memberUser.id}`,
      );
      const trainerBySchedule = await trainerApi.get(
        `class-booking/class-schedule/${testData.testSchedule.id}`,
      );

      expect(trainerList.status()).toBe(403);
      expect(trainerById.status()).toBe(403);
      expect(trainerByUser.status()).toBe(403);
      expect(trainerBySchedule.status()).toBe(403);
    });

    test('allows admins to update booking status and forbids members from the update route', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const memberResponse = await memberApi.patch(`class-booking/${booking.id}`, {
        data: { status: 'attended' },
      });
      expect(memberResponse.status()).toBe(403);

      const adminResponse = await adminApi.patch(`class-booking/${booking.id}`, {
        data: { status: 'attended' },
      });
      expect(adminResponse.status()).toBe(200);

      const body = (await adminResponse.json()) as {
        data: { id: string; status: string };
      };
      expect(body.data.id).toBe(booking.id);
      expect(body.data.status).toBe('attended');
    });

    test('allows member self-cancel, rejects cross-user cancel, and lets admins cancel any booking', async () => {
      const ownBooking = await createBookingDirect({
        userId: testData.memberUser.id,
        status: 'confirmed',
      });
      const ownCancelResponse = await memberApi.patch(
        `class-booking/${ownBooking.id}/cancel`,
      );
      expect(ownCancelResponse.status()).toBe(200);

      const otherBooking = await createBookingDirect({
        userId: testData.adminUser.id,
        status: 'confirmed',
      });
      const forbiddenResponse = await memberApi.patch(
        `class-booking/${otherBooking.id}/cancel`,
      );
      expect(forbiddenResponse.status()).toBe(403);

      const adminCancelResponse = await adminApi.patch(
        `class-booking/${otherBooking.id}/cancel`,
      );
      expect(adminCancelResponse.status()).toBe(200);

      const adminCancelBody = (await adminCancelResponse.json()) as {
        data: { status: string };
      };
      expect(adminCancelBody.data.status).toBe('cancelled');
    });

    test('rejects cancelling attended bookings and lets admins hard-delete bookings', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const attendedBooking = await createBookingDirect({
        bookingDate: nextMonday,
        status: 'attended',
      });

      const cancelResponse = await adminApi.patch(
        `class-booking/${attendedBooking.id}/cancel`,
      );
      const cancelBody = await cancelResponse.json();
      expect(cancelResponse.status()).toBe(400);
      expect(getErrorMessage(cancelBody)).toContain('attended');

      const deletableBooking = await createBookingDirect({
        bookingDate: addDays(nextMonday, 7),
        status: 'pending',
      });
      const memberDeleteResponse = await memberApi.delete(
        `class-booking/${deletableBooking.id}`,
      );
      expect(memberDeleteResponse.status()).toBe(403);

      const adminDeleteResponse = await adminApi.delete(
        `class-booking/${deletableBooking.id}`,
      );
      expect(adminDeleteResponse.status()).toBe(200);

      const getDeletedResponse = await adminApi.get(
        `class-booking/${deletableBooking.id}`,
      );
      expect(getDeletedResponse.status()).toBe(404);
    });
  });

  test.describe('Recurring Slots and Remaining Capacity', () => {
    test('allows the same member to book the same schedule on different dates but not the same date twice', async () => {
      const firstMonday = getNextDayOfWeek('MON');
      const secondMonday = addDays(firstMonday, 7);

      const firstResponse = await createBookingThroughApi(
        testData.memberUser.id,
        firstMonday,
      );
      expect(firstResponse.status()).toBe(201);

      const secondResponse = await createBookingThroughApi(
        testData.memberUser.id,
        secondMonday,
      );
      expect(secondResponse.status()).toBe(201);

      const duplicateResponse = await createBookingThroughApi(
        testData.memberUser.id,
        firstMonday,
      );
      const duplicateBody = await duplicateResponse.json();
      expect(duplicateResponse.status()).toBe(400);
      expect(getErrorMessage(duplicateBody)).toContain(
        'already has an active booking',
      );
    });

    test('allows cancel-and-rebook on the same date without creating duplicate rows', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      const createResponse = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      expect(createResponse.status()).toBe(201);
      const createBody = (await createResponse.json()) as {
        data: Array<{ id: string }>;
      };
      const bookingId = createBody.data[0].id;

      const cancelResponse = await adminApi.patch(
        `class-booking/${bookingId}/cancel`,
      );
      expect(cancelResponse.status()).toBe(200);

      const rebookResponse = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      expect(rebookResponse.status()).toBe(201);

      const bookings = await prisma.classBooking.findMany({
        where: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
        },
      });

      expect(bookings).toHaveLength(1);
      expect(bookings[0].status).toBe('pending');
    });

    test('counts capacity per date, not across all schedule occurrences', async () => {
      const firstMonday = getNextDayOfWeek('MON');
      const secondMonday = addDays(firstMonday, 7);

      for (let index = 0; index < DEFAULT_CAPACITY - 1; index += 1) {
        const tempUser = await createTempUser(`date-a-${index}`);
        await createBookingDirect({
          userId: tempUser.id,
          bookingDate: firstMonday,
          status: 'confirmed',
        });
      }

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        secondMonday,
      );
      expect(response.status()).toBe(201);
    });

    test('does not count cancelled bookings toward capacity', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      for (let index = 0; index < DEFAULT_CAPACITY; index += 1) {
        const tempUser = await createTempUser(`cancelled-${index}`);
        await createBookingDirect({
          userId: tempUser.id,
          bookingDate: nextMonday,
          status: index < 2 ? 'cancelled' : 'confirmed',
        });
      }

      const response = await createBookingThroughApi(
        testData.memberUser.id,
        nextMonday,
      );
      expect(response.status()).toBe(201);
    });

    test('returns date-aware remaining slots on list and detail schedule endpoints', async () => {
      const firstMonday = getNextDayOfWeek('MON');
      const secondMonday = addDays(firstMonday, 7);

      for (let index = 0; index < 2; index += 1) {
        const tempUser = await createTempUser(`slots-a-${index}`);
        await createBookingDirect({
          userId: tempUser.id,
          bookingDate: firstMonday,
          status: 'confirmed',
        });
      }

      for (let index = 0; index < 4; index += 1) {
        const tempUser = await createTempUser(`slots-b-${index}`);
        await createBookingDirect({
          userId: tempUser.id,
          bookingDate: secondMonday,
          status: 'confirmed',
        });
      }

      const listFirstDate = await adminApi.get(
        `class-schedule/list?date=${formatDate(firstMonday)}&limit=100&q=API Integration Test Class`,
      );
      expect(listFirstDate.status()).toBe(200);
      const listFirstBody = (await listFirstDate.json()) as {
        data: {
          docs: Array<{
            id: string;
            currentBookings: number;
            remainingSlots: number;
          }>;
        };
      };
      const firstSchedule = listFirstBody.data.docs.find(
        (schedule) => schedule.id === testData.testSchedule.id,
      );
      expect(firstSchedule?.currentBookings).toBe(2);
      expect(firstSchedule?.remainingSlots).toBe(3);

      const listSecondDate = await adminApi.get(
        `class-schedule/list?date=${formatDate(secondMonday)}&limit=100&q=API Integration Test Class`,
      );
      expect(listSecondDate.status()).toBe(200);
      const listSecondBody = (await listSecondDate.json()) as {
        data: {
          docs: Array<{
            id: string;
            currentBookings: number;
            remainingSlots: number;
          }>;
        };
      };
      const secondSchedule = listSecondBody.data.docs.find(
        (schedule) => schedule.id === testData.testSchedule.id,
      );
      expect(secondSchedule?.currentBookings).toBe(4);
      expect(secondSchedule?.remainingSlots).toBe(1);

      const detailWithDate = await adminApi.get(
        `class-schedule/${testData.testSchedule.id}?date=${formatDate(firstMonday)}`,
      );
      expect(detailWithDate.status()).toBe(200);
      const detailWithDateBody = (await detailWithDate.json()) as {
        data: { currentBookings: number; remainingSlots: number };
      };
      expect(detailWithDateBody.data.currentBookings).toBe(2);
      expect(detailWithDateBody.data.remainingSlots).toBe(3);

      const detailAutoDate = await adminApi.get(
        `class-schedule/${testData.testSchedule.id}`,
      );
      expect(detailAutoDate.status()).toBe(200);
      const detailAutoDateBody = (await detailAutoDate.json()) as {
        data: { currentBookings: number; remainingSlots: number };
      };
      expect(detailAutoDateBody.data.currentBookings).toBe(2);
      expect(detailAutoDateBody.data.remainingSlots).toBe(3);
    });

    test('updates schedule read models after booking create and cancel on the same date', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const isolatedSchedule = await createAdditionalSchedule();

      const beforeResponse = await adminApi.get(
        `class-schedule/${isolatedSchedule.id}?date=${formatDate(nextMonday)}`,
      );
      expect(beforeResponse.status()).toBe(200);
      const beforeBody = (await beforeResponse.json()) as {
        data: { currentBookings: number; remainingSlots: number };
      };
      const initialBookings = beforeBody.data.currentBookings;
      const initialRemainingSlots = beforeBody.data.remainingSlots;

      const createResponse = await adminApi.post('class-booking/create', {
        data: {
          userId: testData.memberUser.id,
          classScheduleId: [isolatedSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        },
      });
      expect(createResponse.status()).toBe(201);
      const createBody = (await createResponse.json()) as {
        data: Array<{ id: string }>;
      };
      const bookingId = createBody.data[0].id;

      const afterCreateResponse = await adminApi.get(
        `class-schedule/${isolatedSchedule.id}?date=${formatDate(nextMonday)}`,
      );
      expect(afterCreateResponse.status()).toBe(200);
      const afterCreateBody = (await afterCreateResponse.json()) as {
        data: { currentBookings: number; remainingSlots: number };
      };
      expect(afterCreateBody.data.currentBookings).toBe(initialBookings + 1);
      expect(afterCreateBody.data.remainingSlots).toBe(
        initialRemainingSlots - 1,
      );

      const cancelResponse = await adminApi.patch(
        `class-booking/${bookingId}/cancel`,
      );
      expect(cancelResponse.status()).toBe(200);

      const afterCancelResponse = await adminApi.get(
        `class-schedule/${isolatedSchedule.id}?date=${formatDate(nextMonday)}`,
      );
      expect(afterCancelResponse.status()).toBe(200);
      const afterCancelBody = (await afterCancelResponse.json()) as {
        data: { currentBookings: number; remainingSlots: number };
      };
      expect(afterCancelBody.data.currentBookings).toBe(initialBookings);
      expect(afterCancelBody.data.remainingSlots).toBe(initialRemainingSlots);
    });
  });

  test.describe('Checkout and Payment Transitions', () => {
    test('requires authentication for checkout and returns a checkout URL for a valid pending booking', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const anonymousResponse = await anonymousApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(anonymousResponse.status()).toBe(401);

      const memberResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(memberResponse.status()).toBe(201);

      const body = (await memberResponse.json()) as {
        data: { checkoutUrl: string };
      };
      expect(body.data.checkoutUrl).toContain('http');

      const payment = await findLatestBookingPayment(booking.id);
      expect(payment).not.toBeNull();
      expect(payment?.status).toBe('PENDING');
    });

    test('forbids admin, trainer, and staff from using the member-only checkout route', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const adminResponse = await adminApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      const trainerResponse = await trainerApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      const staffResponse = await staffApi.post(
        `class-booking/${booking.id}/checkout`,
      );

      expect(adminResponse.status()).toBe(403);
      expect(trainerResponse.status()).toBe(403);
      expect(staffResponse.status()).toBe(403);
    });

    test('returns the same checkout URL on repeated checkout attempts for the same pending booking', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const firstResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(firstResponse.status()).toBe(201);
      const firstBody = (await firstResponse.json()) as {
        data: { checkoutUrl: string };
      };

      const secondResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(secondResponse.status()).toBe(201);
      const secondBody = (await secondResponse.json()) as {
        data: { checkoutUrl: string };
      };

      expect(secondBody.data.checkoutUrl).toBe(firstBody.data.checkoutUrl);
      expect(await countBookingPayments(booking.id)).toBe(1);
    });

    test('rejects checkout for another user, non-pending bookings, and schedules without price', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const otherUserBooking = await createBookingDirect({
        bookingDate: nextMonday,
        userId: testData.adminUser.id,
        status: 'pending',
      });
      const forbiddenResponse = await memberApi.post(
        `class-booking/${otherUserBooking.id}/checkout`,
      );
      expect(forbiddenResponse.status()).toBe(403);

      const confirmedBooking = await createBookingDirect({
        bookingDate: addDays(nextMonday, 7),
        status: 'confirmed',
      });
      const confirmedResponse = await memberApi.post(
        `class-booking/${confirmedBooking.id}/checkout`,
      );
      expect(confirmedResponse.status()).toBe(400);

      await prisma.classSchedule.update({
        where: { id: testData.testSchedule.id },
        data: { price: 0 },
      });
      const noPriceBooking = await createBookingDirect({
        bookingDate: addDays(nextMonday, 14),
        status: 'pending',
      });
      const noPriceResponse = await memberApi.post(
        `class-booking/${noPriceBooking.id}/checkout`,
      );
      expect(noPriceResponse.status()).toBe(400);
    });

    test('confirms a booking after a successful checkout webhook', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const checkoutResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(checkoutResponse.status()).toBe(201);

      const payment = await findLatestBookingPayment(booking.id);
      expect(payment?.providerSessionId).toBeTruthy();

      await triggerStripeWebhook({
        id: `evt_booking_success_${Date.now()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: payment!.providerSessionId,
            payment_intent: `pi_booking_success_${Date.now()}`,
          },
        },
      });

      await expect
        .poll(
          async () =>
            (
              await prisma.classBooking.findUnique({
                where: { id: booking.id },
                select: { status: true },
              })
            )?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('confirmed');

      await expect
        .poll(
          async () => (await findLatestBookingPayment(booking.id))?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('SUCCESS');
    });

    test('keeps a booking confirmed when the success webhook is delivered twice', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const checkoutResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(checkoutResponse.status()).toBe(201);

      const payment = await findLatestBookingPayment(booking.id);
      expect(payment?.providerSessionId).toBeTruthy();

      const paymentIntentId = `pi_booking_success_duplicate_${Date.now()}`;
      const eventPayload = {
        id: `evt_booking_success_duplicate_${Date.now()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: payment!.providerSessionId,
            payment_intent: paymentIntentId,
          },
        },
      };

      await triggerStripeWebhook(eventPayload);
      await triggerStripeWebhook(eventPayload);

      await expect
        .poll(
          async () =>
            (
              await prisma.classBooking.findUnique({
                where: { id: booking.id },
                select: { status: true },
              })
            )?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('confirmed');
    });

    test('cancels a booking and emits a payment notification after payment failure', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const checkoutResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(checkoutResponse.status()).toBe(201);

      const payment = await findLatestBookingPayment(booking.id);
      expect(payment).not.toBeNull();

      await triggerStripeWebhook({
        id: `evt_booking_failed_${Date.now()}`,
        object: 'event',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: `pi_booking_failed_${Date.now()}`,
            metadata: {
              paymentId: payment!.id,
            },
          },
        },
      });

      await expect
        .poll(
          async () =>
            (
              await prisma.classBooking.findUnique({
                where: { id: booking.id },
                select: { status: true },
              })
            )?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('cancelled');

      await expect
        .poll(
          async () => (await findLatestBookingPayment(booking.id))?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('FAILED');

      await expect
        .poll(
          async () =>
            prisma.notification.count({
              where: {
                userId: testData.memberUser.id,
                referenceId: booking.id,
              },
            }),
          { timeout: 10000 },
        )
        .toBe(1);
    });

    test('keeps a booking cancelled and avoids duplicate notifications when the failure event is delivered twice', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const checkoutResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(checkoutResponse.status()).toBe(201);

      const payment = await findLatestBookingPayment(booking.id);
      expect(payment).not.toBeNull();

      const failedEvent = {
        id: `evt_booking_failed_duplicate_${Date.now()}`,
        object: 'event',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: `pi_booking_failed_duplicate_${Date.now()}`,
            metadata: {
              paymentId: payment!.id,
            },
          },
        },
      };

      await triggerStripeWebhook(failedEvent);
      await expect
        .poll(
          async () =>
            prisma.notification.count({
              where: {
                userId: testData.memberUser.id,
                referenceId: booking.id,
              },
            }),
          { timeout: 10000 },
        )
        .toBe(1);

      await triggerStripeWebhook(failedEvent);

      await expect
        .poll(
          async () =>
            (
              await prisma.classBooking.findUnique({
                where: { id: booking.id },
                select: { status: true },
              })
            )?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('cancelled');

      expect(
        await prisma.notification.count({
          where: {
            userId: testData.memberUser.id,
            referenceId: booking.id,
          },
        }),
      ).toBe(1);
    });

    test('cancels a confirmed booking after a refund webhook', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const checkoutResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(checkoutResponse.status()).toBe(201);

      const payment = await findLatestBookingPayment(booking.id);
      expect(payment?.providerSessionId).toBeTruthy();

      const paymentIntentId = `pi_booking_refund_${Date.now()}`;
      await triggerStripeWebhook({
        id: `evt_booking_confirm_before_refund_${Date.now()}`,
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
              await prisma.classBooking.findUnique({
                where: { id: booking.id },
                select: { status: true },
              })
            )?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('confirmed');

      await triggerStripeWebhook({
        id: `evt_booking_refund_${Date.now()}`,
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
            (
              await prisma.classBooking.findUnique({
                where: { id: booking.id },
                select: { status: true },
              })
            )?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('cancelled');

      await expect
        .poll(
          async () => (await findLatestBookingPayment(booking.id))?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('REFUNDED');
    });

    test('keeps a refunded booking cancelled when the refund webhook is delivered twice', async () => {
      const booking = await createBookingDirect({
        status: 'pending',
      });

      const checkoutResponse = await memberApi.post(
        `class-booking/${booking.id}/checkout`,
      );
      expect(checkoutResponse.status()).toBe(201);

      const payment = await findLatestBookingPayment(booking.id);
      expect(payment?.providerSessionId).toBeTruthy();

      const paymentIntentId = `pi_booking_refund_duplicate_${Date.now()}`;
      await triggerStripeWebhook({
        id: `evt_booking_refund_duplicate_confirm_${Date.now()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: payment!.providerSessionId,
            payment_intent: paymentIntentId,
          },
        },
      });

      const refundEvent = {
        id: `evt_booking_refund_duplicate_${Date.now()}`,
        object: 'event',
        type: 'charge.refunded',
        data: {
          object: {
            payment_intent: paymentIntentId,
          },
        },
      };

      await triggerStripeWebhook(refundEvent);
      await triggerStripeWebhook(refundEvent);

      await expect
        .poll(
          async () =>
            (
              await prisma.classBooking.findUnique({
                where: { id: booking.id },
                select: { status: true },
              })
            )?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('cancelled');

      await expect
        .poll(
          async () => (await findLatestBookingPayment(booking.id))?.status ?? null,
          { timeout: 10000 },
        )
        .toBe('REFUNDED');
    });
  });
});
