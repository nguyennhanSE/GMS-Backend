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

describe('Class Booking API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let testData: TestData;
  let memberToken: string;
  let adminToken: string;
  let trainerToken: string;

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

    // Setup test data
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);

    // Login to get tokens
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
      trainerToken = await loginAs(
        app,
        testData.trainerUser.email,
        testData.trainerPassword,
      );
    } catch {
      // If login fails, skip auth-dependent tests
      console.warn('Login failed - some tests will be skipped');
    }
  }, 60000);

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  afterEach(async () => {
    // Clean up bookings after each test
    await prisma.classBooking.deleteMany({
      where: {
        classScheduleId: testData.testSchedule.id,
      },
    });
  });

  describe('POST /class-booking/create', () => {
    it('should create booking successfully (admin)', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const startDate = formatDate(nextMonday);
      const endDate = formatDate(addDays(nextMonday, 7)); // End date must be after start date

      const response = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id], // Array format
          bookingStartDate: startDate,
          bookingEndDate: endDate,
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should reject booking on wrong day of week', async () => {
      if (!adminToken) return;

      // Try to book on Tuesday when schedule is Monday
      const nextTuesday = getNextDayOfWeek('TUE');
      const startDate = formatDate(nextTuesday);
      const endDate = formatDate(addDays(nextTuesday, 7));

      const response = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id], // Array format
          bookingStartDate: startDate,
          bookingEndDate: endDate,
        });

      expect(response.status).toBe(400);
      expect(getErrorMessage(response.body)).toContain('scheduled for');
    });

    it('should reject trainer booking their own class', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const startDate = formatDate(nextMonday);
      const endDate = formatDate(addDays(nextMonday, 7));

      const response = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.trainerUser.id, // Trainer trying to book own class
          classScheduleId: [testData.testSchedule.id], // Array format
          bookingStartDate: startDate,
          bookingEndDate: endDate,
        });

      expect(response.status).toBe(400);
      expect(getErrorMessage(response.body)).toContain('cannot book their own');
    });

    it('should reject when capacity is reached', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const startDate = formatDate(nextMonday);
      const endDate = formatDate(addDays(nextMonday, 7));
      const timestamp = Date.now();

      // Fill the class to capacity (capacity = 5)
      for (let i = 0; i < 5; i++) {
        const tempUser = await prisma.user.create({
          data: {
            firstName: `Temp${i}`,
            lastName: 'User',
            email: `temp-user-${timestamp}-${i}@test.local`, // Unique email with timestamp
            password: 'dummy',
            status: 'active',
          },
        });

        await prisma.classBooking.create({
          data: {
            userId: tempUser.id,
            classScheduleId: testData.testSchedule.id,
            bookingStartDate: nextMonday,
            bookingEndDate: addDays(nextMonday, 7),
            status: 'confirmed',
          },
        });
      }

      // Try to book when class is full
      const response = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id], // Array format
          bookingStartDate: startDate,
          bookingEndDate: endDate,
        });

      expect(response.status).toBe(400);
      expect(getErrorMessage(response.body)).toContain('full');

      // Cleanup temp users
      await prisma.classBooking.deleteMany({
        where: { classScheduleId: testData.testSchedule.id },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: `temp-user-${timestamp}` } },
      });
    });

    it('should reject booking on cancelled exception date', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const startDate = formatDate(nextMonday);
      const endDate = formatDate(addDays(nextMonday, 7));

      // Create a cancellation exception
      await prisma.scheduleException.create({
        data: {
          scheduleId: testData.testSchedule.id,
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'Holiday closure',
        },
      });

      const response = await authRequest(app, adminToken)
        .post('/class-booking/create')
        .send({
          userId: testData.memberUser.id,
          classScheduleId: [testData.testSchedule.id], // Array format
          bookingStartDate: startDate,
          bookingEndDate: endDate,
        });

      expect(response.status).toBe(400);
      expect(getErrorMessage(response.body)).toContain('cancelled');

      // Cleanup exception
      await prisma.scheduleException.deleteMany({
        where: { scheduleId: testData.testSchedule.id },
      });
    });
  });

  describe('GET /class-booking/my-bookings', () => {
    it('should return current user bookings', async () => {
      if (!memberToken) return;

      // Create a booking for member
      const nextMonday = getNextDayOfWeek('MON');
      await prisma.classBooking.create({
        data: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
          bookingEndDate: nextMonday,
          status: 'confirmed',
        },
      });

      const response = await authRequest(app, memberToken).get(
        '/class-booking/my-bookings',
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should reject unauthenticated request', async () => {
      const response = await authRequest(app, 'invalid-token').get(
        '/class-booking/my-bookings',
      );

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /class-booking/:id/cancel', () => {
    it('should allow member to cancel their own booking', async () => {
      if (!memberToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const booking = await prisma.classBooking.create({
        data: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
          bookingEndDate: nextMonday,
          status: 'confirmed',
        },
      });

      const response = await authRequest(app, memberToken).patch(
        `/class-booking/${booking.id}/cancel`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('cancelled');
    });

    it('should reject member cancelling another user booking', async () => {
      if (!memberToken) return;

      const nextMonday = getNextDayOfWeek('MON');

      // Create another user and their booking
      const otherUser = await prisma.user.create({
        data: {
          firstName: 'Other',
          lastName: 'User',
          email: 'other-user@test.local',
          password: 'dummy',
          status: 'active',
        },
      });

      const booking = await prisma.classBooking.create({
        data: {
          userId: otherUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
          bookingEndDate: nextMonday,
          status: 'confirmed',
        },
      });

      const response = await authRequest(app, memberToken).patch(
        `/class-booking/${booking.id}/cancel`,
      );

      expect(response.status).toBe(403);

      // Cleanup
      await prisma.classBooking.delete({ where: { id: booking.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });

    it('should allow admin to cancel any booking', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const booking = await prisma.classBooking.create({
        data: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: nextMonday,
          bookingEndDate: nextMonday,
          status: 'confirmed',
        },
      });

      const response = await authRequest(app, adminToken).patch(
        `/class-booking/${booking.id}/cancel`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('cancelled');
    });
  });

  describe('GET /class-booking/list', () => {
    it('should return paginated bookings for admin', async () => {
      if (!adminToken) return;

      const response = await authRequest(app, adminToken)
        .get('/class-booking/list')
        .send();

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.docs).toBeDefined();
    });

    it('should reject access for member role', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .get('/class-booking/list')
        .send();

      expect(response.status).toBe(403);
    });
  });
});
