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
  }, 60000);

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  afterEach(async () => {
    await prisma.classBooking.deleteMany({
      where: { classScheduleId: testData.testSchedule.id },
    });
    // Clean up exceptions after each test
    await prisma.scheduleException.deleteMany({
      where: { scheduleId: testData.testSchedule.id },
    });
  });

  describe('POST /class-schedule/:scheduleId/exceptions', () => {
    it('should allow admin to create exception', async () => {
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
      const response = await authRequest(app, memberToken).get(
        `/class-schedule/${testData.testSchedule.id}/exceptions`,
      );

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /class-schedule/exceptions/:exceptionId', () => {
    it('should allow admin to update exception', async () => {
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

  describe('Class Schedule Read Model Integration', () => {
    it('should reflect exception create and delete in date-scoped detail responses', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);

      const createResponse = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'RESCHEDULED',
          reason: 'Moved to afternoon',
          newStartTime: '14:00',
          newEndTime: '15:00',
        });

      expect(createResponse.status).toBe(201);

      const detailWithException = await authRequest(app, adminToken).get(
        `/class-schedule/${testData.testSchedule.id}?date=${dateStr}`,
      );

      expect(detailWithException.status).toBe(200);
      expect(detailWithException.body.data.occurrence).toMatchObject({
        date: dateStr,
        status: 'rescheduled',
        isBookable: true,
        exception: {
          id: createResponse.body.data.id,
          type: 'RESCHEDULED',
          reason: 'Moved to afternoon',
        },
      });
      expect(detailWithException.body.data.startTime).toContain('T10:00:00.000Z');
      expect(detailWithException.body.data.currentBookings).toBe(
        detailWithException.body.data.occurrence.currentBookings,
      );
      expect(detailWithException.body.data.remainingSlots).toBe(
        detailWithException.body.data.occurrence.remainingSlots,
      );
      expect(detailWithException.body.data.occurrence.effectiveStartTime).toBe(
        detailWithException.body.data.occurrence.exception.newStartTime,
      );
      expect(detailWithException.body.data.occurrence.effectiveEndTime).toBe(
        detailWithException.body.data.occurrence.exception.newEndTime,
      );
      expect(detailWithException.body.data.occurrence.effectiveStartTime).not.toBe(
        detailWithException.body.data.startTime,
      );
      expect(detailWithException.body.data.occurrence.effectiveEndTime).not.toBe(
        detailWithException.body.data.endTime,
      );

      const deleteResponse = await authRequest(app, adminToken).delete(
        `/class-schedule/exceptions/${createResponse.body.data.id}`,
      );

      expect(deleteResponse.status).toBe(200);

      const detailAfterDelete = await authRequest(app, adminToken).get(
        `/class-schedule/${testData.testSchedule.id}?date=${dateStr}`,
      );

      expect(detailAfterDelete.status).toBe(200);
      expect(detailAfterDelete.body.data.occurrence).toMatchObject({
        date: dateStr,
        status: 'scheduled',
        isBookable: true,
        exception: null,
      });
      expect(detailAfterDelete.body.data.currentBookings).toBe(
        detailAfterDelete.body.data.occurrence.currentBookings,
      );
      expect(detailAfterDelete.body.data.remainingSlots).toBe(
        detailAfterDelete.body.data.occurrence.remainingSlots,
      );
      expect(detailAfterDelete.body.data.occurrence.effectiveStartTime).toBe(
        detailAfterDelete.body.data.startTime,
      );
      expect(detailAfterDelete.body.data.occurrence.effectiveEndTime).toBe(
        detailAfterDelete.body.data.endTime,
      );
    });

    it('should use the same date normalization for booking counts and exception lookup', async () => {
      const nextMonday = getNextDayOfWeek('MON');
      const dateStr = formatDate(nextMonday);
      const midnightUtc = new Date(`${dateStr}T00:00:00.000Z`);

      await prisma.classBooking.create({
        data: {
          userId: testData.memberUser.id,
          classScheduleId: testData.testSchedule.id,
          bookingStartDate: midnightUtc,
          bookingEndDate: midnightUtc,
          status: 'confirmed',
        },
      });

      const exceptionResponse = await authRequest(app, adminToken)
        .post(`/class-schedule/${testData.testSchedule.id}/exceptions`)
        .send({
          exceptionDate: dateStr,
          type: 'CANCELLED',
          reason: 'Normalization proof',
        });

      expect(exceptionResponse.status).toBe(201);

      const detailResponse = await authRequest(app, adminToken).get(
        `/class-schedule/${testData.testSchedule.id}?date=${dateStr}`,
      );

      expect(detailResponse.status).toBe(200);
      expect(detailResponse.body.data.currentBookings).toBe(1);
      expect(detailResponse.body.data.occurrence).toMatchObject({
        date: dateStr,
        status: 'cancelled',
        currentBookings: 1,
        remainingSlots: 0,
        exception: {
          type: 'CANCELLED',
          reason: 'Normalization proof',
        },
      });
    });
  });
});
