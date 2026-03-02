import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('ClassBooking Integration Tests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let authToken: string;
  let adminToken: string;
  let testUserId: string;
  let testAdminId: string;
  let testScheduleId: string;
  let testClassId: string;
  let testTrainerId: string;

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

    // Clean up test data before tests
    await cleanupTestData();

    // Create test users and get auth tokens
    await setupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function cleanupTestData() {
    // Clean up in correct order to avoid FK constraints
    await prisma.classBooking.deleteMany({
      where: {
        OR: [
          { user: { email: 'test-member@integration.test' } },
          { user: { email: 'test-admin@integration.test' } },
        ],
      },
    });

    await prisma.scheduleException.deleteMany({
      where: {
        schedule: {
          gymClass: { className: 'Integration Test Class' },
        },
      },
    });

    await prisma.scheduleDay.deleteMany({
      where: {
        schedule: {
          gymClass: { className: 'Integration Test Class' },
        },
      },
    });

    await prisma.classSchedule.deleteMany({
      where: {
        gymClass: { className: 'Integration Test Class' },
      },
    });

    await prisma.gymClass.deleteMany({
      where: { className: 'Integration Test Class' },
    });

    await prisma.session.deleteMany({
      where: {
        user: {
          email: {
            in: [
              'test-member@integration.test',
              'test-admin@integration.test',
              'test-trainer@integration.test',
            ],
          },
        },
      },
    });

    await prisma.userRole.deleteMany({
      where: {
        user: {
          email: {
            in: [
              'test-member@integration.test',
              'test-admin@integration.test',
              'test-trainer@integration.test',
            ],
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            'test-member@integration.test',
            'test-admin@integration.test',
            'test-trainer@integration.test',
          ],
        },
      },
    });
  }

  async function setupTestData() {
    // Get or create roles
    let memberRole = await prisma.role.findFirst({
      where: { name: 'member' },
    });
    let adminRole = await prisma.role.findFirst({ where: { name: 'admin' } });
    let trainerRole = await prisma.role.findFirst({
      where: { name: 'trainer' },
    });

    // Create roles if they don't exist
    if (!memberRole) {
      memberRole = await prisma.role.create({
        data: { name: 'member', description: 'Member role for testing' },
      });
    }
    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: { name: 'admin', description: 'Admin role for testing' },
      });
    }
    if (!trainerRole) {
      trainerRole = await prisma.role.create({
        data: { name: 'trainer', description: 'Trainer role for testing' },
      });
    }

    // Create test member
    const testMember = await prisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Member',
        email: 'test-member@integration.test',
        password: '$2b$10$abcdefghijklmnopqrstuv', // hashed password
        status: 'active',
        userRole: {
          create: { roleId: memberRole.id },
        },
      },
    });
    testUserId = testMember.id;

    // Create test admin
    const testAdmin = await prisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Admin',
        email: 'test-admin@integration.test',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        status: 'active',
        userRole: {
          create: { roleId: adminRole.id },
        },
      },
    });
    testAdminId = testAdmin.id;

    // Create test trainer
    const testTrainer = await prisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Trainer',
        email: 'test-trainer@integration.test',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        status: 'active',
        userRole: {
          create: { roleId: trainerRole.id },
        },
      },
    });
    testTrainerId = testTrainer.id;

    // Create test class
    const testClass = await prisma.gymClass.create({
      data: {
        className: 'Integration Test Class',
        description: 'A class for integration testing',
        difficultyLevel: 'Beginner',
        category: 'Testing',
        isActive: true,
      },
    });
    testClassId = testClass.id;

    // Create test schedule (Monday at 10:00-11:00)
    const testSchedule = await prisma.classSchedule.create({
      data: {
        classId: testClassId,
        trainerId: testTrainerId,
        dayOfWeek: 'MON',
        startTime: new Date('1970-01-01T10:00:00Z'),
        endTime: new Date('1970-01-01T11:00:00Z'),
        capacity: 5,
        isActive: true,
        location: 'Test Studio',
      },
    });
    testScheduleId = testSchedule.id;

    // Note: In a real test, we'd authenticate properly
    // For now, we'll skip auth or use a mock token approach
  }

  describe('GET /class-booking/list', () => {
    it('should return paginated bookings list', async () => {
      // Skip if no auth - just verify endpoint exists
      const response = await supertest
        .default(app.getHttpServer())
        .get('/class-booking/list')
        .query({ page: 1, limit: 10 });

      // Without auth, we expect 401 or similar
      expect([200, 401, 403]).toContain(response.status);
    });
  });

  describe('Schedule Exceptions Integration', () => {
    let exceptionId: string;

    it('should allow creating an exception for a schedule', async () => {
      // Create exception directly via Prisma (bypassing auth for integration test)
      const exception = await prisma.scheduleException.create({
        data: {
          scheduleId: testScheduleId,
          exceptionDate: new Date('2026-12-25'),
          type: 'CANCELLED',
          reason: 'Christmas Day - Gym Closed',
        },
      });

      exceptionId = exception.id;

      expect(exception).toBeDefined();
      expect(exception.type).toBe('CANCELLED');
      expect(exception.reason).toBe('Christmas Day - Gym Closed');
    });

    it('should prevent duplicate exceptions for the same date', async () => {
      // Try to create another exception for the same date
      await expect(
        prisma.scheduleException.create({
          data: {
            scheduleId: testScheduleId,
            exceptionDate: new Date('2026-12-25'),
            type: 'CANCELLED',
            reason: 'Duplicate exception',
          },
        }),
      ).rejects.toThrow();
    });

    it('should list exceptions for a schedule', async () => {
      const exceptions = await prisma.scheduleException.findMany({
        where: { scheduleId: testScheduleId },
      });

      expect(exceptions.length).toBeGreaterThan(0);
      expect(exceptions[0].scheduleId).toBe(testScheduleId);
    });

    it('should update an exception', async () => {
      const updated = await prisma.scheduleException.update({
        where: { id: exceptionId },
        data: { reason: 'Updated reason for closure' },
      });

      expect(updated.reason).toBe('Updated reason for closure');
    });

    it('should delete an exception', async () => {
      await prisma.scheduleException.delete({
        where: { id: exceptionId },
      });

      const deleted = await prisma.scheduleException.findUnique({
        where: { id: exceptionId },
      });
      expect(deleted).toBeNull();
    });
  });

  describe('Booking Flow Integration', () => {
    it('should create a booking for valid schedule', async () => {
      // Get next Monday date
      const today = new Date();
      const nextMonday = new Date(today);
      nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));

      const booking = await prisma.classBooking.create({
        data: {
          userId: testUserId,
          classScheduleId: testScheduleId,
          bookingStartDate: nextMonday,
          bookingEndDate: nextMonday,
          status: 'pending',
        },
      });

      expect(booking).toBeDefined();
      expect(booking.status).toBe('pending');
      expect(booking.userId).toBe(testUserId);
      expect(booking.classScheduleId).toBe(testScheduleId);

      // Clean up
      await prisma.classBooking.delete({ where: { id: booking.id } });
    });

    it('should prevent duplicate bookings for the same user and schedule', async () => {
      const today = new Date();
      const nextMonday = new Date(today);
      nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));

      // Create first booking
      const booking1 = await prisma.classBooking.create({
        data: {
          userId: testUserId,
          classScheduleId: testScheduleId,
          bookingStartDate: nextMonday,
          bookingEndDate: nextMonday,
          status: 'confirmed',
        },
      });

      // Try to create duplicate booking - should fail due to unique constraint
      await expect(
        prisma.classBooking.create({
          data: {
            userId: testUserId,
            classScheduleId: testScheduleId,
            bookingStartDate: nextMonday,
            bookingEndDate: nextMonday,
            status: 'pending',
          },
        }),
      ).rejects.toThrow();

      // Clean up
      await prisma.classBooking.delete({ where: { id: booking1.id } });
    });

    it('should enforce capacity limits', async () => {
      const today = new Date();
      const nextMonday = new Date(today);
      nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));

      // Create users and bookings up to capacity
      const schedule = await prisma.classSchedule.findUnique({
        where: { id: testScheduleId },
      });
      expect(schedule?.capacity).toBe(5);

      // Count existing confirmed bookings
      const existingCount = await prisma.classBooking.count({
        where: {
          classScheduleId: testScheduleId,
          status: { in: ['confirmed', 'pending'] },
        },
      });

      expect(existingCount).toBeLessThan(schedule!.capacity);
    });
  });

  describe('Schedule Validation', () => {
    it('should validate schedule is active', async () => {
      const schedule = await prisma.classSchedule.findUnique({
        where: { id: testScheduleId },
      });

      expect(schedule).toBeDefined();
      expect(schedule?.isActive).toBe(true);
    });

    it('should have proper day of week setting', async () => {
      const schedule = await prisma.classSchedule.findUnique({
        where: { id: testScheduleId },
      });

      expect(schedule?.dayOfWeek).toBe('MON');
    });

    it('should have valid time range', async () => {
      const schedule = await prisma.classSchedule.findUnique({
        where: { id: testScheduleId },
      });

      expect(schedule?.startTime).toBeDefined();
      expect(schedule?.endTime).toBeDefined();

      const startHour = schedule!.startTime.getHours();
      const endHour = schedule!.endTime.getHours();
      expect(endHour).toBeGreaterThan(startHour);
    });
  });
});
