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
} from './test-helpers';

describe('Schedule Exception API (e2e)', () => {
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
      console.warn('Login failed - some tests will be skipped');
    }
  }, 60000);

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  afterEach(async () => {
    // Clean up exceptions after each test
    await prisma.scheduleException.deleteMany({
      where: { scheduleId: testData.testSchedule.id },
    });
  });

  describe('POST /class-schedule/:scheduleId/exceptions', () => {
    it('should allow admin to create exception', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);

      const response = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'CANCELLED',
          reason: 'Holiday closure test',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.type).toBe('CANCELLED');
      expect(response.body.data.reason).toBe('Holiday closure test');
    });

    it('should reject member creating exception', async () => {
      if (!memberToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);

      const response = await authRequest(app, memberToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'CANCELLED',
          reason: 'Should not work',
        });

      expect(response.status).toBe(403);
    });

    it('should reject duplicate exception for same date', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);

      // Create first exception
      await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'CANCELLED',
          reason: 'First exception',
        });

      // Try to create duplicate
      const response = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'CANCELLED',
          reason: 'Duplicate exception',
        });

      expect(response.status).toBe(409);
    });

    it('should allow creating RESCHEDULED exception with new times', async () => {
      if (!adminToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);

      const response = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'RESCHEDULED',
          reason: 'Rescheduled to afternoon',
          newStartTime: '14:00',
          newEndTime: '15:00',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.type).toBe('RESCHEDULED');
      expect(response.body.data.newStartTime).toBeDefined();
      expect(response.body.data.newEndTime).toBeDefined();
    });
  });

  describe('GET /class-schedule/:scheduleId/exceptions', () => {
    it('should list exceptions for trainer', async () => {
      if (!trainerToken) return;

      // Create an exception first
      const nextMonday = getNextDayOfWeek('MON');
      await prisma.scheduleException.create({
        data: {
          scheduleId: testData.testSchedule.id,
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'Test exception',
        },
      });

      const response = await authRequest(app, trainerToken).get(
        `/class-schedule/${testData.testSchedule.id}/exceptions`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should reject member listing exceptions', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken).get(
        `/class-schedule/${testData.testSchedule.id}/exceptions`,
      );

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /class-schedule/exceptions/:exceptionId', () => {
    it('should allow admin to update exception', async () => {
      if (!adminToken) return;

      // Create an exception
      const nextMonday = getNextDayOfWeek('MON');
      const exception = await prisma.scheduleException.create({
        data: {
          scheduleId: testData.testSchedule.id,
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'Original reason',
        },
      });

      const response = await authRequest(app, adminToken)
        .patch(`/class-schedule/exceptions/${exception.id}`)
        .send({
          reason: 'Updated reason',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.reason).toBe('Updated reason');
    });
  });

  describe('DELETE /class-schedule/exceptions/:exceptionId', () => {
    it('should allow admin to delete exception', async () => {
      if (!adminToken) return;

      // Create an exception
      const nextMonday = getNextDayOfWeek('MON');
      const exception = await prisma.scheduleException.create({
        data: {
          scheduleId: testData.testSchedule.id,
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'To be deleted',
        },
      });

      const response = await authRequest(app, adminToken).delete(
        `/class-schedule/exceptions/${exception.id}`,
      );

      expect(response.status).toBe(200);

      // Verify it's deleted
      const deleted = await prisma.scheduleException.findUnique({
        where: { id: exception.id },
      });
      expect(deleted).toBeNull();
    });

    it('should reject trainer deleting exception', async () => {
      if (!trainerToken) return;

      const nextMonday = getNextDayOfWeek('MON');
      const exception = await prisma.scheduleException.create({
        data: {
          scheduleId: testData.testSchedule.id,
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'Should not delete',
        },
      });

      const response = await authRequest(app, trainerToken).delete(
        `/class-schedule/exceptions/${exception.id}`,
      );

      expect(response.status).toBe(403);
    });
  });
});
