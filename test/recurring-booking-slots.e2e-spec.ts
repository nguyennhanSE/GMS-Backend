import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  TestData,
  loginAs,
  authRequest,
  createTestData,
  cleanupTestData,
  getNextDayOfWeek,
  formatDate,
  addDays,
  getErrorMessage,
} from './test-helpers';

/**
 * Integration tests for:
 * 1. Recurring booking bug fixes (unique constraint, duplicate check, capacity check)
 * 2. Remaining slots tracking (date-aware currentBookings / remainingSlots)
 */
describe('Recurring Booking Fixes & Remaining Slots (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let testData: TestData;
  let adminToken: string;
  let memberToken: string;
  const tempUserEmailPrefixes = [
    'cap-test-',
    'full-test-',
    'cancel-cap-',
    'slot-test-',
    'date-a-',
    'date-b-',
  ];

  async function cleanupRecurringBookingTempUsers(): Promise<void> {
    const userEmailFilters = tempUserEmailPrefixes.map((prefix) => ({
      email: { contains: prefix },
    }));

    await prisma.classBooking.deleteMany({
      where: {
        user: {
          OR: userEmailFilters,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        OR: userEmailFilters,
      },
    });
  }

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

    await cleanupTestData(prisma);
    await cleanupRecurringBookingTempUsers();
    testData = await createTestData(prisma);
    adminToken = await loginAs(
      app,
      testData.adminUser.email,
      testData.adminPassword,
    );
    memberToken = await loginAs(
      app,
      testData.memberUser.email,
      testData.memberPassword,
    );
  }, 60000);

  afterAll(async () => {
    await cleanupRecurringBookingTempUsers();
    await cleanupTestData(prisma);
    await app.close();
  });

  afterEach(async () => {
    await cleanupRecurringBookingTempUsers();
    await prisma.classBooking.deleteMany({
      where: { classScheduleId: testData.testSchedule.id },
    });
    await prisma.scheduleException.deleteMany({
      where: { scheduleId: testData.testSchedule.id },
    });
  });

  // ==========================================================
  // BUG FIX TESTS: Recurring Schedule Booking
  // ==========================================================

  describe('Bug Fix: Per-Date Booking (not all-time)', () => {
    it('should allow booking the same schedule on different dates', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const mondayAfter = addDays(nextMonday, 7);

      // Book for first Monday
      const res1 = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        });

      expect(res1.status).toBe(201);
      expect(res1.body.data).toBeDefined();

      // Book for second Monday — should SUCCEED (different date)
      const res2 = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(mondayAfter),
          bookingEndDate: formatDate(addDays(mondayAfter, 1)),
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data).toBeDefined();

      // Verify both bookings exist
      const bookings = await prisma.classBooking.findMany({
        where: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
        },
      });
      expect(bookings.length).toBe(2);
    });

    it('should NOT allow double-booking the same schedule on the same date', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      // First booking
      const res1 = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        });

      expect(res1.status).toBe(201);

      // Second booking — same date — should FAIL
      const res2 = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        });

      expect(res2.status).toBe(400);
      expect(getErrorMessage(res2.body)).toContain(
        'already has an active booking',
      );
    });
  });

  describe('Bug Fix: Cancel & Rebook', () => {
    it('should allow rebooking same schedule and date after cancellation', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      // 1. Create booking
      const createRes = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        });

      expect(createRes.status).toBe(201);
      const bookingId = createRes.body.data[0].id;

      // 2. Cancel booking
      const cancelRes = await authRequest(app, adminToken).patch(
        `/class-booking/${bookingId}/cancel`,
      );

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('cancelled');

      // 3. Rebook same schedule, same date — should SUCCEED (upsert reactivates)
      const rebookRes = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        });

      expect(rebookRes.status).toBe(201);
      expect(rebookRes.body.data).toBeDefined();

      // 4. Verify the booking is now pending (reactivated, not a new row)
      const bookings = await prisma.classBooking.findMany({
        where: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
        },
      });

      // Should be exactly 1 row (upserted, not duplicated)
      expect(bookings.length).toBe(1);
      expect(bookings[0].status).toBe('pending');
    });
  });

  describe('Bug Fix: Per-Date Capacity Check', () => {
    it('should count capacity per-date, not all-time', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const mondayAfter = addDays(nextMonday, 7);

      // Test schedule has capacity = 5
      // Pre-cleanup leftover temp users from previous runs
      await prisma.classBooking.deleteMany({
        where: { user: { email: { contains: 'cap-test-' } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'cap-test-' } },
      });
      // Create 4 bookings for the first Monday (using direct Prisma to speed up)
      for (let i = 0; i < 4; i++) {
        const tempUser = await prisma.user.create({
          data: {
            firstName: `CapUser${i}`,
            lastName: 'Test',
            email: `cap-test-${i}@test.local`,
            password: 'dummy',
            status: 'active',
          },
        });
        await prisma.classBooking.create({
          data: {
            userId: tempUser.id,
            classScheduleId: testData.testSchedule.id,
            bookingStartDate: nextMonday,
            bookingEndDate: nextMonday,
            status: 'confirmed',
          },
        });
      }

      // Book member for second Monday — should SUCCEED
      // (4 bookings on first Monday should NOT affect second Monday's capacity)
      const res = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(mondayAfter),
          bookingEndDate: formatDate(addDays(mondayAfter, 1)),
        });

      expect(res.status).toBe(201);

      // Cleanup temp users
      await prisma.classBooking.deleteMany({
        where: {
          user: { email: { contains: 'cap-test-' } },
        },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'cap-test-' } },
      });
    });

    it('should reject booking when specific date is at capacity', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      // Pre-cleanup leftover temp users
      await prisma.classBooking.deleteMany({
        where: { user: { email: { contains: 'full-test-' } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'full-test-' } },
      });
      // Fill all 5 slots for this Monday
      for (let i = 0; i < 5; i++) {
        const tempUser = await prisma.user.create({
          data: {
            firstName: `FullUser${i}`,
            lastName: 'Test',
            email: `full-test-${i}@test.local`,
            password: 'dummy',
            status: 'active',
          },
        });
        await prisma.classBooking.create({
          data: {
            userId: tempUser.id,
            classScheduleId: testData.testSchedule.id,
            bookingStartDate: nextMonday,
            bookingEndDate: nextMonday,
            status: 'confirmed',
          },
        });
      }

      // Try to book member for the same full Monday — should FAIL
      const res = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        });

      expect(res.status).toBe(400);
      expect(getErrorMessage(res.body)).toContain('full');

      // Cleanup temp users
      await prisma.classBooking.deleteMany({
        where: {
          user: { email: { contains: 'full-test-' } },
        },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'full-test-' } },
      });
    });

    it('should NOT count cancelled bookings toward capacity', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      // Pre-cleanup leftover temp users
      await prisma.classBooking.deleteMany({
        where: { user: { email: { contains: 'cancel-cap-' } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'cancel-cap-' } },
      });
      // Create 5 bookings but cancel 2 of them
      const tempUserIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const tempUser = await prisma.user.create({
          data: {
            firstName: `CancelCapUser${i}`,
            lastName: 'Test',
            email: `cancel-cap-${i}@test.local`,
            password: 'dummy',
            status: 'active',
          },
        });
        tempUserIds.push(tempUser.id);
        await prisma.classBooking.create({
          data: {
            userId: tempUser.id,
            classScheduleId: testData.testSchedule.id,
            bookingStartDate: nextMonday,
            bookingEndDate: nextMonday,
            status: i < 2 ? 'cancelled' : 'confirmed', // First 2 cancelled
          },
        });
      }

      // 3 confirmed + 2 cancelled = 3 active, capacity = 5 → should SUCCEED
      const res = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id],
          bookingStartDate: formatDate(nextMonday),
          bookingEndDate: formatDate(addDays(nextMonday, 1)),
        });

      expect(res.status).toBe(201);

      // Cleanup
      await prisma.classBooking.deleteMany({
        where: { user: { email: { contains: 'cancel-cap-' } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'cancel-cap-' } },
      });
    });
  });

  // ==========================================================
  // REMAINING SLOTS TRACKING TESTS
  // ==========================================================

  describe('Remaining Slots: GET /class-schedule/list', () => {
    it('should return currentBookings and remainingSlots in response', async () => {
      const response = await authRequest(app, adminToken)
        .get('/class-schedule/list')
        .send();

      expect(response.status).toBe(200);
      expect(response.body.data.docs).toBeDefined();

      const schedules = response.body.data.docs;
      expect(schedules.length).toBeGreaterThan(0);

      // Every schedule should have remainingSlots fields
      for (const schedule of schedules) {
        expect(schedule).toHaveProperty('currentBookings');
        expect(schedule).toHaveProperty('remainingSlots');
        expect(typeof schedule.currentBookings).toBe('number');
        expect(typeof schedule.remainingSlots).toBe('number');
        expect(schedule.remainingSlots).toBeGreaterThanOrEqual(0);
        expect(schedule).not.toHaveProperty('occurrence');
      }
    });

    it('should return correct remainingSlots for a specific date', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      // Create 3 bookings for this Monday
      for (let i = 0; i < 3; i++) {
        const tempUser = await prisma.user.create({
          data: {
            firstName: `SlotUser${i}`,
            lastName: 'Test',
            email: `slot-test-${i}@test.local`,
            password: 'dummy',
            status: 'active',
          },
        });
        await prisma.classBooking.create({
          data: {
            userId: tempUser.id,
            classScheduleId: testData.testSchedule.id,
            bookingStartDate: nextMonday,
            bookingEndDate: nextMonday,
            status: 'confirmed',
          },
        });
      }

      // Query with date param
      const response = await authRequest(app, adminToken)
        .get(`/class-schedule/list?date=${formatDate(nextMonday)}`)
        .send();

      expect(response.status).toBe(200);

      const testSchedule = response.body.data.docs.find(
        (s: any) => s.id === testData.testSchedule.id,
      );

      if (testSchedule) {
        // capacity=5, 3 bookings → currentBookings=3, remainingSlots=2
        expect(testSchedule.currentBookings).toBe(3);
        expect(testSchedule.remainingSlots).toBe(2);
        expect(testSchedule.occurrence).toMatchObject({
          date: formatDate(nextMonday),
          status: 'scheduled',
          isBookable: true,
          currentBookings: 3,
          remainingSlots: 2,
          exception: null,
        });
      }

      // Cleanup
      await prisma.classBooking.deleteMany({
        where: { user: { email: { contains: 'slot-test-' } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'slot-test-' } },
      });
    });

    it('should show independent slots for different dates', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const mondayAfter = addDays(nextMonday, 7);

      // 2 bookings on first Monday
      for (let i = 0; i < 2; i++) {
        const tempUser = await prisma.user.create({
          data: {
            firstName: `DateA${i}`,
            lastName: 'Test',
            email: `date-a-${i}@test.local`,
            password: 'dummy',
            status: 'active',
          },
        });
        await prisma.classBooking.create({
          data: {
            userId: tempUser.id,
            classScheduleId: testData.testSchedule.id,
            bookingStartDate: nextMonday,
            bookingEndDate: nextMonday,
            status: 'confirmed',
          },
        });
      }

      // 4 bookings on second Monday
      for (let i = 0; i < 4; i++) {
        const tempUser = await prisma.user.create({
          data: {
            firstName: `DateB${i}`,
            lastName: 'Test',
            email: `date-b-${i}@test.local`,
            password: 'dummy',
            status: 'active',
          },
        });
        await prisma.classBooking.create({
          data: {
            userId: tempUser.id,
            classScheduleId: testData.testSchedule.id,
            bookingStartDate: mondayAfter,
            bookingEndDate: mondayAfter,
            status: 'confirmed',
          },
        });
      }

      // Check date A: 2 bookings → 3 remaining
      const resA = await authRequest(app, adminToken)
        .get(`/class-schedule/list?date=${formatDate(nextMonday)}`)
        .send();

      const scheduleA = resA.body.data.docs.find(
        (s: any) => s.id === testData.testSchedule.id,
      );
      if (scheduleA) {
        expect(scheduleA.currentBookings).toBe(2);
        expect(scheduleA.remainingSlots).toBe(3);
      }

      // Check date B: 4 bookings → 1 remaining
      const resB = await authRequest(app, adminToken)
        .get(`/class-schedule/list?date=${formatDate(mondayAfter)}`)
        .send();

      const scheduleB = resB.body.data.docs.find(
        (s: any) => s.id === testData.testSchedule.id,
      );
      if (scheduleB) {
        expect(scheduleB.currentBookings).toBe(4);
        expect(scheduleB.remainingSlots).toBe(1);
      }

      // Cleanup
      await prisma.classBooking.deleteMany({
        where: {
          user: { email: { contains: 'date-a-' } },
        },
      });
      await prisma.classBooking.deleteMany({
        where: {
          user: { email: { contains: 'date-b-' } },
        },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'date-a-' } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'date-b-' } },
      });
    });

    it('should keep cancelled occurrences visible but unbookable in list responses', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);

      const exceptionResponse = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'CANCELLED',
          reason: 'Holiday closure',
        });

      expect(exceptionResponse.status).toBe(201);

      const response = await authRequest(app, adminToken)
        .get(`/class-schedule/list?date=${dateStr}&q=API Integration Test Class`)
        .send();

      expect(response.status).toBe(200);

      const schedule = response.body.data.docs.find(
        (item: any) => item.id === testData.testSchedule.id,
      );

      expect(schedule).toBeDefined();
      expect(schedule.occurrence).toMatchObject({
        date: dateStr,
        status: 'cancelled',
        isBookable: false,
        remainingSlots: 0,
        exception: {
          type: 'CANCELLED',
          reason: 'Holiday closure',
        },
      });
      expect(schedule.remainingSlots).toBe(0);
      expect(schedule.currentBookings).toBe(schedule.occurrence.currentBookings);
    });

    it('should return rescheduled effective times from the exception in list responses', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);

      const exceptionResponse = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'RESCHEDULED',
          reason: 'Moved to afternoon',
          newStartTime: '14:00',
          newEndTime: '15:00',
        });

      expect(exceptionResponse.status).toBe(201);

      const response = await authRequest(app, adminToken)
        .get(`/class-schedule/list?date=${dateStr}&q=API Integration Test Class`)
        .send();

      expect(response.status).toBe(200);

      const schedule = response.body.data.docs.find(
        (item: any) => item.id === testData.testSchedule.id,
      );

      expect(schedule).toBeDefined();
      expect(schedule.startTime).toContain('T10:00:00.000Z');
      expect(schedule.endTime).toContain('T11:00:00.000Z');
      expect(schedule.occurrence).toMatchObject({
        date: dateStr,
        status: 'rescheduled',
        isBookable: true,
        exception: {
          type: 'RESCHEDULED',
          reason: 'Moved to afternoon',
        },
      });
      expect(schedule.currentBookings).toBe(schedule.occurrence.currentBookings);
      expect(schedule.remainingSlots).toBe(schedule.occurrence.remainingSlots);
      expect(schedule.occurrence.effectiveStartTime).toBe(
        schedule.occurrence.exception.newStartTime,
      );
      expect(schedule.occurrence.effectiveEndTime).toBe(
        schedule.occurrence.exception.newEndTime,
      );
      expect(schedule.occurrence.effectiveStartTime).not.toBe(schedule.startTime);
      expect(schedule.occurrence.effectiveEndTime).not.toBe(schedule.endTime);
    });
  });

  describe('Remaining Slots: GET /class-schedule/:id', () => {
    it('should return remainingSlots for a specific schedule with date', async () => {
      const nextMonday = getNextDayOfWeek('MON');

      // Create 1 booking
      await prisma.classBooking.create({
        data: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
          bookingEndDate: nextMonday,
          status: 'confirmed',
        },
      });

      const response = await authRequest(app, adminToken).get(
        `/class-schedule/${testData.testSchedule.id}?date=${formatDate(nextMonday)}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.currentBookings).toBe(1);
      expect(response.body.data.remainingSlots).toBe(4); // capacity=5 - 1 booking
      expect(response.body.data.occurrence).toMatchObject({
        date: formatDate(nextMonday),
        status: 'scheduled',
        isBookable: true,
        currentBookings: 1,
        remainingSlots: 4,
        exception: null,
      });
    });

    it('should omit occurrence when no date is provided', async () => {
      const response = await authRequest(app, adminToken).get(
        `/class-schedule/${testData.testSchedule.id}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).not.toHaveProperty('occurrence');
    });
  });

  describe('Occurrence Contract: Date-Aware Exception Projection', () => {
    it('should keep cancelled occurrences visible but unbookable in detail responses', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const exceptionResponse = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: formatDate(nextMonday),
          type: 'CANCELLED',
          reason: 'Holiday closure',
        });

      expect(exceptionResponse.status).toBe(201);

      const response = await authRequest(app, adminToken).get(
        `/class-schedule/${testData.testSchedule.id}?date=${formatDate(nextMonday)}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.remainingSlots).toBe(0);
      expect(typeof response.body.data.currentBookings).toBe('number');
      expect(response.body.data.occurrence).toMatchObject({
        date: formatDate(nextMonday),
        status: 'cancelled',
        isBookable: false,
        remainingSlots: 0,
        exception: {
          type: 'CANCELLED',
          reason: 'Holiday closure',
        },
      });
      expect(response.body.data.currentBookings).toBe(
        response.body.data.occurrence.currentBookings,
      );
      expect(response.body.data.occurrence.effectiveStartTime).toContain(
        'T10:00:00.000Z',
      );
      expect(response.body.data.occurrence.effectiveEndTime).toContain(
        'T11:00:00.000Z',
      );
    });

    it('should preserve template times while projecting rescheduled occurrence times', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const exceptionResponse = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: formatDate(nextMonday),
          type: 'RESCHEDULED',
          reason: 'Moved to afternoon',
          newStartTime: '14:00',
          newEndTime: '15:00',
        });

      expect(exceptionResponse.status).toBe(201);

      const response = await authRequest(app, adminToken).get(
        `/class-schedule/${testData.testSchedule.id}?date=${formatDate(nextMonday)}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.startTime).toContain('T10:00:00.000Z');
      expect(response.body.data.endTime).toContain('T11:00:00.000Z');
      expect(response.body.data.occurrence).toMatchObject({
        date: formatDate(nextMonday),
        status: 'rescheduled',
        isBookable: true,
        exception: {
          type: 'RESCHEDULED',
          reason: 'Moved to afternoon',
        },
      });
      expect(response.body.data.currentBookings).toBe(
        response.body.data.occurrence.currentBookings,
      );
      expect(response.body.data.remainingSlots).toBe(
        response.body.data.occurrence.remainingSlots,
      );
      expect(response.body.data.occurrence.effectiveStartTime).toBe(
        response.body.data.occurrence.exception.newStartTime,
      );
      expect(response.body.data.occurrence.effectiveEndTime).toBe(
        response.body.data.occurrence.exception.newEndTime,
      );
      expect(response.body.data.occurrence.effectiveStartTime).not.toBe(
        response.body.data.startTime,
      );
      expect(response.body.data.occurrence.effectiveEndTime).not.toBe(
        response.body.data.endTime,
      );
    });
  });
});
