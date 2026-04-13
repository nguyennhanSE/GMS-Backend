import { expect, test, type APIRequestContext } from '@playwright/test';
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
import { createApiContext, loginAs } from './api-helpers';

const prisma = new PrismaService();
const TRAINER_DAY_MAP = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
} as const;
const DEFAULT_CAPACITY = 5;

test.describe('Class Schedule Playwright API E2E', () => {
  let testData: TestData;
  let anonymousApi: APIRequestContext;
  let adminApi: APIRequestContext;
  let memberApi: APIRequestContext;
  let trainerApi: APIRequestContext;

  test.beforeAll(async () => {
    await prisma.$connect();
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);
    await resetScenarioState();

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
  });

  test.afterEach(async () => {
    await resetScenarioState();
  });

  test.afterAll(async () => {
    await resetScenarioState();
    await Promise.all([
      anonymousApi?.dispose(),
      adminApi?.dispose(),
      memberApi?.dispose(),
      trainerApi?.dispose(),
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

  async function resetScenarioState() {
    const schedules = await prisma.classSchedule.findMany({
      where: { classId: testData.testClass.id },
      select: { id: true },
    });
    const scheduleIds = schedules.map((schedule) => schedule.id);
    const extraScheduleIds = scheduleIds.filter((id) => id !== testData.testSchedule.id);

    if (scheduleIds.length > 0) {
      await prisma.classBooking.deleteMany({
        where: { classScheduleId: { in: scheduleIds } },
      });
      await prisma.scheduleException.deleteMany({
        where: { scheduleId: { in: scheduleIds } },
      });
    }

    if (extraScheduleIds.length > 0) {
      await prisma.scheduleDay.deleteMany({
        where: { scheduleId: { in: extraScheduleIds } },
      });
      await prisma.classSchedule.deleteMany({
        where: { id: { in: extraScheduleIds } },
      });
    }

    await prisma.scheduleDay.deleteMany({
      where: { scheduleId: testData.testSchedule.id },
    });

    await prisma.classSchedule.update({
      where: { id: testData.testSchedule.id },
      data: {
        dayOfWeek: 'MON',
        startTime: new Date('1970-01-01T10:00:00Z'),
        endTime: new Date('1970-01-01T11:00:00Z'),
        validFrom: null,
        validUntil: null,
        location: 'Test Studio A',
        capacity: DEFAULT_CAPACITY,
        isActive: true,
        scheduleDays: {
          create: [{ dayOfWeek: 'MON' }],
        },
      },
    });

    await prisma.trainerAvailability.deleteMany({
      where: { trainerId: testData.trainerUser.id },
    });

    await prisma.trainerAvailability.createMany({
      data: Object.entries(TRAINER_DAY_MAP).map(([dayOfWeek, dayNumber]) => ({
        trainerId: testData.trainerUser.id,
        dayOfWeek: dayNumber,
        startTime: new Date('1970-01-01T08:00:00Z'),
        endTime: new Date('1970-01-01T18:00:00Z'),
        isAvailable: true,
      })),
    });
  }

  function buildSchedulePayload(overrides?: {
    classId?: string;
    trainerId?: string;
    dayOfWeek?: string;
    daysOfWeek?: string[];
    startTime?: string;
    endTime?: string;
    location?: string;
    capacity?: number;
    isActive?: boolean;
  }) {
    return {
      classId: overrides?.classId ?? testData.testClass.id,
      trainerId: overrides?.trainerId ?? testData.trainerUser.id,
      daysOfWeek: overrides?.daysOfWeek ?? ['TUE', 'THU'],
      dayOfWeek: overrides?.dayOfWeek,
      startTime: overrides?.startTime ?? '2025-01-01T13:00:00.000Z',
      endTime: overrides?.endTime ?? '2025-01-01T14:00:00.000Z',
      location: overrides?.location ?? `Playwright Studio ${Date.now()}`,
      capacity: overrides?.capacity ?? 12,
      isActive: overrides?.isActive ?? true,
    };
  }

  async function createBookingForDate(targetDate: Date, status = 'confirmed') {
    return prisma.classBooking.create({
      data: {
        userId: testData.memberUser.id,
        classScheduleId: testData.testSchedule.id,
        bookingStartDate: targetDate,
        bookingEndDate: addDays(targetDate, 1),
        status,
      },
    });
  }

  test('allows an admin to create a multi-day schedule and exposes it to member list queries', async () => {
    const payload = buildSchedulePayload();

    const createResponse = await adminApi.post('class-schedule/create', {
      data: payload,
    });

    expect(createResponse.status()).toBe(201);

    const createBody = (await createResponse.json()) as {
      data: {
        id: string;
        dayOfWeek: string;
        daysOfWeek: string[];
        location: string;
        capacity: number;
      };
    };

    expect(createBody.data.dayOfWeek).toBe('TUE');
    expect(createBody.data.daysOfWeek).toEqual(['TUE', 'THU']);
    expect(createBody.data.capacity).toBe(payload.capacity);
    expect(createBody.data.location).toBe(payload.location);

    const nextTuesday = formatDate(getNextDayOfWeek('TUE'));
    const listResponse = await memberApi.get(
      `class-schedule/list?classId=${testData.testClass.id}&dayOfWeek=TUE&date=${nextTuesday}`,
    );

    expect(listResponse.status()).toBe(200);

    const listBody = (await listResponse.json()) as {
      data: {
        docs: Array<{
          id: string;
          dayOfWeek: string;
          daysOfWeek: string[];
          occurrence: { status: string };
          currentBookings: number;
          remainingSlots: number;
        }>;
      };
    };

    const createdSchedule = listBody.data.docs.find(
      (schedule) => schedule.id === createBody.data.id,
    );

    expect(createdSchedule).toBeDefined();
    expect(createdSchedule?.dayOfWeek).toBe('TUE');
    expect(createdSchedule?.daysOfWeek).toEqual(['TUE', 'THU']);
    expect(createdSchedule?.occurrence.status).toBe('scheduled');
    expect(createdSchedule?.currentBookings).toBe(0);
    expect(createdSchedule?.remainingSlots).toBe(payload.capacity);
  });

  test('reports schedule conflicts to admins, forbids members, and rejects overlapping schedule creation', async () => {
    const adminConflictResponse = await adminApi.post(
      'class-schedule/check-conflict',
      {
        data: {
          trainerId: testData.trainerUser.id,
          dayOfWeek: 'MON',
          startTime: '2025-01-01T10:30:00.000Z',
          endTime: '2025-01-01T10:45:00.000Z',
        },
      },
    );

    expect(adminConflictResponse.status()).toBe(201);

    const adminConflictBody = (await adminConflictResponse.json()) as {
      data: {
        hasConflict: boolean;
        conflictingSchedules: Array<{ id: string; className: string }>;
      };
    };

    expect(adminConflictBody.data.hasConflict).toBe(true);
    expect(adminConflictBody.data.conflictingSchedules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: testData.testSchedule.id,
          className: testData.testClass.className,
        }),
      ]),
    );

    const memberConflictResponse = await memberApi.post(
      'class-schedule/check-conflict',
      {
        data: {
          trainerId: testData.trainerUser.id,
          dayOfWeek: 'MON',
          startTime: '2025-01-01T10:30:00.000Z',
          endTime: '2025-01-01T10:45:00.000Z',
        },
      },
    );

    expect(memberConflictResponse.status()).toBe(403);

    const createResponse = await adminApi.post('class-schedule/create', {
      data: buildSchedulePayload({
        daysOfWeek: ['MON'],
        startTime: '2025-01-01T10:30:00.000Z',
        endTime: '2025-01-01T11:30:00.000Z',
      }),
    });

    expect(createResponse.status()).toBe(400);
    expect(getErrorMessage(await createResponse.json())).toContain(
      'already has a class scheduled',
    );
  });

  test('returns date-aware booking counts and occurrence state on list and detail endpoints', async () => {
    const nextMonday = getNextDayOfWeek('MON');
    const nextMondayString = formatDate(nextMonday);

    await createBookingForDate(nextMonday);

    const listResponse = await memberApi.get(
      `class-schedule/list?classId=${testData.testClass.id}&date=${nextMondayString}`,
    );

    expect(listResponse.status()).toBe(200);

    const listBody = (await listResponse.json()) as {
      data: {
        docs: Array<{
          id: string;
          currentBookings: number;
          remainingSlots: number;
          occurrence: {
            date: string;
            status: string;
            currentBookings: number;
            remainingSlots: number;
            isBookable: boolean;
          };
        }>;
      };
    };

    const listedSchedule = listBody.data.docs.find(
      (schedule) => schedule.id === testData.testSchedule.id,
    );

    expect(listedSchedule).toBeDefined();
    expect(listedSchedule?.currentBookings).toBe(1);
    expect(listedSchedule?.remainingSlots).toBe(DEFAULT_CAPACITY - 1);
    expect(listedSchedule?.occurrence).toMatchObject({
      date: nextMondayString,
      status: 'scheduled',
      currentBookings: 1,
      remainingSlots: DEFAULT_CAPACITY - 1,
      isBookable: true,
    });

    const detailResponse = await adminApi.get(
      `class-schedule/${testData.testSchedule.id}?date=${nextMondayString}`,
    );

    expect(detailResponse.status()).toBe(200);

    const detailBody = (await detailResponse.json()) as {
      data: {
        currentBookings: number;
        remainingSlots: number;
        occurrence: {
          date: string;
          status: string;
          currentBookings: number;
          remainingSlots: number;
        };
      };
    };

    expect(detailBody.data.currentBookings).toBe(1);
    expect(detailBody.data.remainingSlots).toBe(DEFAULT_CAPACITY - 1);
    expect(detailBody.data.occurrence).toMatchObject({
      date: nextMondayString,
      status: 'scheduled',
      currentBookings: 1,
      remainingSlots: DEFAULT_CAPACITY - 1,
    });
  });

  test('creates a cancellation exception, updates the read model, and allows trainers to list exceptions', async () => {
    const nextMonday = formatDate(getNextDayOfWeek('MON'));

    const createResponse = await adminApi.post(
      `class-schedule/${testData.testSchedule.id}/exceptions`,
      {
        data: {
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'Holiday closure',
        },
      },
    );

    expect(createResponse.status()).toBe(201);

    const createBody = (await createResponse.json()) as {
      data: { id: string; type: string; reason: string };
    };

    expect(createBody.data.type).toBe('CANCELLED');
    expect(createBody.data.reason).toBe('Holiday closure');

    const trainerListResponse = await trainerApi.get(
      `class-schedule/${testData.testSchedule.id}/exceptions`,
    );

    expect(trainerListResponse.status()).toBe(200);

    const trainerListBody = (await trainerListResponse.json()) as {
      data: Array<{ id: string; type: string }>;
    };

    expect(trainerListBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createBody.data.id,
          type: 'CANCELLED',
        }),
      ]),
    );

    const memberListResponse = await memberApi.get(
      `class-schedule/${testData.testSchedule.id}/exceptions`,
    );

    expect(memberListResponse.status()).toBe(403);

    const detailResponse = await adminApi.get(
      `class-schedule/${testData.testSchedule.id}?date=${nextMonday}`,
    );

    expect(detailResponse.status()).toBe(200);

    const detailBody = (await detailResponse.json()) as {
      data: {
        occurrence: {
          status: string;
          isBookable: boolean;
          remainingSlots: number;
          exception: { id: string; type: string; reason: string };
        };
      };
    };

    expect(detailBody.data.occurrence).toMatchObject({
      status: 'cancelled',
      isBookable: false,
      remainingSlots: 0,
      exception: {
        id: createBody.data.id,
        type: 'CANCELLED',
        reason: 'Holiday closure',
      },
    });
  });

  test('updates a schedule exception to rescheduled and restores the normal occurrence after deletion', async () => {
    const nextMonday = formatDate(getNextDayOfWeek('MON'));

    const createResponse = await adminApi.post(
      `class-schedule/${testData.testSchedule.id}/exceptions`,
      {
        data: {
          exceptionDate: nextMonday,
          type: 'CANCELLED',
          reason: 'Initial cancellation',
        },
      },
    );

    expect(createResponse.status()).toBe(201);

    const createBody = (await createResponse.json()) as {
      data: { id: string };
    };

    const updateResponse = await adminApi.patch(
      `class-schedule/exceptions/${createBody.data.id}`,
      {
        data: {
          type: 'RESCHEDULED',
          reason: 'Moved to afternoon',
          newStartTime: '14:00',
          newEndTime: '15:00',
        },
      },
    );

    expect(updateResponse.status()).toBe(200);

    const updatedDetailResponse = await adminApi.get(
      `class-schedule/${testData.testSchedule.id}?date=${nextMonday}`,
    );

    expect(updatedDetailResponse.status()).toBe(200);

    const updatedDetailBody = (await updatedDetailResponse.json()) as {
      data: {
        startTime: string;
        endTime: string;
        occurrence: {
          status: string;
          effectiveStartTime: string;
          effectiveEndTime: string;
          exception: { type: string; reason: string };
        };
      };
    };

    expect(updatedDetailBody.data.occurrence).toMatchObject({
      status: 'rescheduled',
      exception: {
        type: 'RESCHEDULED',
        reason: 'Moved to afternoon',
      },
    });
    expect(updatedDetailBody.data.occurrence.effectiveStartTime).not.toBe(
      updatedDetailBody.data.startTime,
    );
    expect(updatedDetailBody.data.occurrence.effectiveEndTime).not.toBe(
      updatedDetailBody.data.endTime,
    );

    const deleteResponse = await adminApi.delete(
      `class-schedule/exceptions/${createBody.data.id}`,
    );

    expect(deleteResponse.status()).toBe(200);

    const restoredDetailResponse = await adminApi.get(
      `class-schedule/${testData.testSchedule.id}?date=${nextMonday}`,
    );

    expect(restoredDetailResponse.status()).toBe(200);

    const restoredDetailBody = (await restoredDetailResponse.json()) as {
      data: {
        startTime: string;
        endTime: string;
        occurrence: {
          status: string;
          effectiveStartTime: string;
          effectiveEndTime: string;
          exception: null;
        };
      };
    };

    expect(restoredDetailBody.data.occurrence).toMatchObject({
      status: 'scheduled',
      exception: null,
      effectiveStartTime: restoredDetailBody.data.startTime,
      effectiveEndTime: restoredDetailBody.data.endTime,
    });
  });

  test('lets admins update and delete a created schedule', async () => {
    const createResponse = await adminApi.post('class-schedule/create', {
      data: buildSchedulePayload({
        daysOfWeek: ['WED'],
        startTime: '2025-01-01T15:00:00.000Z',
        endTime: '2025-01-01T16:00:00.000Z',
        location: 'Original Studio',
        capacity: 6,
      }),
    });

    expect(createResponse.status()).toBe(201);

    const createBody = (await createResponse.json()) as {
      data: { id: string };
    };

    const updateResponse = await adminApi.patch(
      `class-schedule/${createBody.data.id}`,
      {
        data: {
          dayOfWeek: 'THU',
          startTime: '2025-01-01T16:00:00.000Z',
          endTime: '2025-01-01T17:00:00.000Z',
          location: 'Updated Studio',
          capacity: 9,
        },
      },
    );

    expect(updateResponse.status()).toBe(200);

    const detailResponse = await adminApi.get(
      `class-schedule/${createBody.data.id}?date=${formatDate(getNextDayOfWeek('THU'))}`,
    );

    expect(detailResponse.status()).toBe(200);

    const detailBody = (await detailResponse.json()) as {
      data: {
        id: string;
        dayOfWeek: string;
        location: string;
        capacity: number;
      };
    };

    expect(detailBody.data.id).toBe(createBody.data.id);
    expect(detailBody.data.dayOfWeek).toBe('THU');
    expect(detailBody.data.location).toBe('Updated Studio');
    expect(detailBody.data.capacity).toBe(9);

    const deleteResponse = await adminApi.delete(
      `class-schedule/${createBody.data.id}`,
    );

    expect(deleteResponse.status()).toBe(200);

    const deletedDetailResponse = await adminApi.get(
      `class-schedule/${createBody.data.id}`,
    );

    expect(deletedDetailResponse.status()).toBe(404);
  });
});
