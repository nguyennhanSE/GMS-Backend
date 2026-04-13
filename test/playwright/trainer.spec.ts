import { expect, test, type APIRequestContext } from '@playwright/test';
import { Prisma, TrainerClientLinkStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { getErrorMessage } from '../test-helpers';
import { createApiContext, loginAs } from './api-helpers';

type TestUser = {
  id: string;
  email: string;
  password: string;
};

type TrainerPayloadOverrides = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  status: string;
  specialization: string;
  experienceYears: number;
  biography: string;
  certifications: string[];
  areasOfExpertise: string[];
  ptSessionPrice30: number;
  ptSessionPrice60: number;
  ptSessionPrice90: number;
}>;

const prisma = new PrismaService();
const TEST_PASSWORD = 'PlaywrightTrainer@123';
const suitePrefix = 'playwright-trainer-';
const suiteId = Date.now().toString(36);
const suiteKey = `${suitePrefix}${suiteId}`;
const managedEmailPrefix = `pwt-${suiteId}-trainer`;
const adminEmail = `pwt-${suiteId}-admin@test.local`;
const memberEmail = `pwt-${suiteId}-member@test.local`;

test.describe('Trainer Playwright API E2E', () => {
  let anonymousApi: APIRequestContext;
  let adminApi: APIRequestContext;
  let memberApi: APIRequestContext;

  let adminUser: TestUser;
  let memberUser: TestUser;

  const managedApis: APIRequestContext[] = [];

  test.beforeAll(async () => {
    await prisma.$connect();
    await cleanupSuiteState();
    await setupBaseFixtures();

    anonymousApi = await createApiContext();
    adminApi = await createAuthenticatedContext(adminUser);
    memberApi = await createAuthenticatedContext(memberUser);
  });

  test.afterEach(async () => {
    await Promise.all(managedApis.splice(0).map((api) => api.dispose()));
    await clearPerTestState();
  });

  test.afterAll(async () => {
    await Promise.all([
      anonymousApi?.dispose(),
      adminApi?.dispose(),
      memberApi?.dispose(),
      ...managedApis.splice(0).map((api) => api.dispose()),
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

  async function createManagedTrainer(
    label: string,
    overrides: TrainerPayloadOverrides = {},
  ) {
    const payload = buildTrainerPayload(label, overrides);
    const response = await adminApi.post('trainer/create', {
      data: payload,
    });

    if (![200, 201].includes(response.status())) {
      throw new Error(
        `Trainer create failed (${response.status()}): ${await response.text()}`,
      );
    }

    const body = (await response.json()) as {
      data: {
        id: string;
        email: string;
        trainerSpecialization?: string | null;
        trainerExperienceYears?: number | null;
        trainerBiography?: string | null;
        password?: string;
      };
    };

    expect(body.data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        email: payload.email,
      }),
    );
    expect(body.data.password).toBeUndefined();

    const user = {
      id: body.data.id,
      email: body.data.email,
      password: payload.password,
    };
    const api = await createAuthenticatedContext(user);
    managedApis.push(api);

    return {
      payload,
      user,
      api,
      responseBody: body,
    };
  }

  test('creates trainers with profile fields, supports trainer self-read and self-update, and filters admin listings', async () => {
    const primaryTrainer = await createManagedTrainer('primary', {
      specialization: 'Strength',
      experienceYears: 6,
      biography: 'Strength coach focused on sustainable progress.',
      certifications: ['NASM CPT'],
      areasOfExpertise: ['Strength', 'Hypertrophy'],
      ptSessionPrice60: 320000,
    });
    await createManagedTrainer('secondary', {
      specialization: 'Mobility',
      experienceYears: 4,
      biography: 'Mobility-first trainer profile.',
      certifications: ['FRC'],
      areasOfExpertise: ['Mobility'],
      ptSessionPrice60: 280000,
    });

    const trainerDetailResponse = await primaryTrainer.api.get(
      `trainer/${primaryTrainer.user.id}`,
    );
    expect(trainerDetailResponse.status()).toBe(200);

    const trainerDetailBody = (await trainerDetailResponse.json()) as {
      data: {
        id: string;
        email: string;
        trainerSpecialization: string;
        trainerExperienceYears: number;
        trainerBiography: string;
        trainerCertifications: string[];
        trainerAreasOfExpertise: string[];
      };
    };

    expect(trainerDetailBody.data).toEqual(
      expect.objectContaining({
        id: primaryTrainer.user.id,
        email: primaryTrainer.payload.email,
        trainerSpecialization: 'Strength',
        trainerExperienceYears: 6,
        trainerBiography: 'Strength coach focused on sustainable progress.',
        trainerCertifications: ['NASM CPT'],
        trainerAreasOfExpertise: ['Strength', 'Hypertrophy'],
      }),
    );

    const listResponse = await adminApi.get('trainer/list', {
      params: {
        email: primaryTrainer.payload.email,
        page: '1',
        limit: '10',
      },
    });
    expect(listResponse.status()).toBe(200);

    const listBody = (await listResponse.json()) as {
      data: {
        docs: Array<{
          id: string;
          email: string;
          trainerSpecialization: string | null;
        }>;
      };
    };

    expect(listBody.data.docs).toHaveLength(1);
    expect(listBody.data.docs[0]).toEqual(
      expect.objectContaining({
        id: primaryTrainer.user.id,
        email: primaryTrainer.payload.email,
        trainerSpecialization: 'Strength',
      }),
    );

    const forbiddenListResponse = await memberApi.get('trainer/list');
    expect(forbiddenListResponse.status()).toBe(403);

    const updateResponse = await primaryTrainer.api.patch(
      `trainer/${primaryTrainer.user.id}`,
      {
        data: {
          biography: 'Updated trainer biography',
          experienceYears: 7,
          ptSessionPrice90: 490000,
        },
      },
    );
    expect(updateResponse.status()).toBe(200);

    const updateBody = (await updateResponse.json()) as {
      data: {
        trainerBiography: string | null;
        trainerExperienceYears: number | null;
        ptSessionPrice90: number | null;
      };
    };

    expect(updateBody.data).toEqual(
      expect.objectContaining({
        trainerBiography: 'Updated trainer biography',
        trainerExperienceYears: 7,
        ptSessionPrice90: 490000,
      }),
    );
  });

  test('validates trainer creation permissions and duplicate email handling', async () => {
    const memberCreateResponse = await memberApi.post('trainer/create', {
      data: buildTrainerPayload('member-blocked'),
    });
    expect(memberCreateResponse.status()).toBe(403);

    const shortPasswordResponse = await adminApi.post('trainer/create', {
      data: buildTrainerPayload('short-password', {
        password: 'short',
      }),
    });
    expect(shortPasswordResponse.status()).toBe(400);
    expect(getErrorMessage(await shortPasswordResponse.json())).toContain(
      'password must be longer than or equal to 8 characters',
    );

    const trainer = await createManagedTrainer('duplicate-source');
    const duplicateResponse = await adminApi.post('trainer/create', {
      data: buildTrainerPayload('duplicate-copy', {
        email: trainer.payload.email,
      }),
    });

    expect(duplicateResponse.status()).toBe(400);
    expect(getErrorMessage(await duplicateResponse.json())).toContain(
      'Trainer with this email already exists',
    );
  });

  test('supports trainer availability lifecycle while enforcing read and write roles', async () => {
    const trainer = await createManagedTrainer('availability');

    const setAvailabilityResponse = await trainer.api.put(
      `trainer/${trainer.user.id}/availability`,
      {
        data: {
          slots: [
            { dayOfWeek: 'MON', startTime: '09:00', endTime: '12:00' },
            { dayOfWeek: 'WED', startTime: '14:00', endTime: '18:00' },
          ],
        },
      },
    );
    expect(setAvailabilityResponse.status()).toBe(200);

    const setAvailabilityBody = (await setAvailabilityResponse.json()) as {
      data: {
        trainerId: string;
        availability: Array<{ id: string; dayOfWeek: number }>;
      };
    };

    expect(setAvailabilityBody.data.trainerId).toBe(trainer.user.id);
    expect(setAvailabilityBody.data.availability).toHaveLength(2);

    const memberReadResponse = await memberApi.get(
      `trainer/${trainer.user.id}/availability`,
    );
    expect(memberReadResponse.status()).toBe(200);

    const memberReadBody = (await memberReadResponse.json()) as {
      data: {
        availability: Array<{ id: string }>;
      };
    };
    expect(memberReadBody.data.availability).toHaveLength(2);

    const memberWriteResponse = await memberApi.put(
      `trainer/${trainer.user.id}/availability`,
      {
        data: {
          slots: [
            { dayOfWeek: 'FRI', startTime: '10:00', endTime: '12:00' },
          ],
        },
      },
    );
    expect(memberWriteResponse.status()).toBe(403);

    const replaceAvailabilityResponse = await trainer.api.put(
      `trainer/${trainer.user.id}/availability`,
      {
        data: {
          slots: [
            { dayOfWeek: 'FRI', startTime: '10:00', endTime: '13:00' },
          ],
        },
      },
    );
    expect(replaceAvailabilityResponse.status()).toBe(200);

    const replaceAvailabilityBody = (await replaceAvailabilityResponse.json()) as {
      data: {
        availability: Array<{ id: string }>;
      };
    };
    expect(replaceAvailabilityBody.data.availability).toHaveLength(1);

    const slotId = replaceAvailabilityBody.data.availability[0].id;
    const deleteSlotResponse = await trainer.api.delete(
      `trainer/${trainer.user.id}/availability/${slotId}`,
    );
    expect(deleteSlotResponse.status()).toBe(200);

    const afterDeleteResponse = await memberApi.get(
      `trainer/${trainer.user.id}/availability`,
    );
    expect(afterDeleteResponse.status()).toBe(200);

    const afterDeleteBody = (await afterDeleteResponse.json()) as {
      data: {
        availability: unknown[];
      };
    };
    expect(afterDeleteBody.data.availability).toHaveLength(0);
  });

  test('enforces working-hours and overlap checks when class schedules are created for a trainer', async () => {
    const trainer = await createManagedTrainer('schedule-check');

    const availabilityResponse = await trainer.api.put(
      `trainer/${trainer.user.id}/availability`,
      {
        data: {
          slots: [
            { dayOfWeek: 'MON', startTime: '09:00', endTime: '17:00' },
          ],
        },
      },
    );
    expect(availabilityResponse.status()).toBe(200);

    const gymClass = await prisma.gymClass.create({
      data: {
        className: `${suiteKey}-class-schedule`,
        description: 'Playwright trainer schedule validation class',
        difficultyLevel: 'Beginner',
        category: 'Testing',
        isActive: true,
      },
    });

    const allowedResponse = await adminApi.post('class-schedule/create', {
      data: {
        classId: gymClass.id,
        trainerId: trainer.user.id,
        dayOfWeek: 'MON',
        startTime: '1970-01-01T10:00:00Z',
        endTime: '1970-01-01T11:00:00Z',
        capacity: 10,
        location: 'Trainer Validation Studio',
      },
    });
    expect([200, 201]).toContain(allowedResponse.status());

    const outsideHoursResponse = await adminApi.post('class-schedule/create', {
      data: {
        classId: gymClass.id,
        trainerId: trainer.user.id,
        dayOfWeek: 'TUE',
        startTime: '1970-01-01T10:00:00Z',
        endTime: '1970-01-01T11:00:00Z',
        capacity: 10,
        location: 'Trainer Validation Studio',
      },
    });
    expect(outsideHoursResponse.status()).toBe(400);
    expect(getErrorMessage(await outsideHoursResponse.json())).toContain(
      'Cannot create schedule: Trainer does not work on TUE',
    );

    const overlapResponse = await adminApi.post('class-schedule/create', {
      data: {
        classId: gymClass.id,
        trainerId: trainer.user.id,
        dayOfWeek: 'MON',
        startTime: '1970-01-01T10:30:00Z',
        endTime: '1970-01-01T11:30:00Z',
        capacity: 10,
        location: 'Trainer Validation Studio',
      },
    });
    expect(overlapResponse.status()).toBe(400);
    expect(getErrorMessage(await overlapResponse.json())).toContain(
      'Conflicting schedule(s):',
    );
  });

  test('enforces working-hours and overlap checks when class schedules are updated for a trainer', async () => {
    const trainer = await createManagedTrainer('schedule-update');

    const availabilityResponse = await trainer.api.put(
      `trainer/${trainer.user.id}/availability`,
      {
        data: {
          slots: [
            { dayOfWeek: 'MON', startTime: '09:00', endTime: '17:00' },
          ],
        },
      },
    );
    expect(availabilityResponse.status()).toBe(200);

    const [primaryClass, blockingClass] = await Promise.all([
      prisma.gymClass.create({
        data: {
          className: `${suiteKey}-class-schedule-update-primary`,
          description: 'Primary schedule update validation class',
          difficultyLevel: 'Beginner',
          category: 'Testing',
          isActive: true,
        },
      }),
      prisma.gymClass.create({
        data: {
          className: `${suiteKey}-class-schedule-update-blocking`,
          description: 'Blocking schedule update validation class',
          difficultyLevel: 'Intermediate',
          category: 'Testing',
          isActive: true,
        },
      }),
    ]);

    const primaryScheduleResponse = await adminApi.post('class-schedule/create', {
      data: {
        classId: primaryClass.id,
        trainerId: trainer.user.id,
        dayOfWeek: 'MON',
        startTime: '1970-01-01T10:00:00Z',
        endTime: '1970-01-01T11:00:00Z',
        capacity: 10,
        location: 'Trainer Validation Studio',
      },
    });
    expect([200, 201]).toContain(primaryScheduleResponse.status());
    const primaryScheduleBody = (await primaryScheduleResponse.json()) as {
      data: { id: string };
    };

    const blockingScheduleResponse = await adminApi.post('class-schedule/create', {
      data: {
        classId: blockingClass.id,
        trainerId: trainer.user.id,
        dayOfWeek: 'MON',
        startTime: '1970-01-01T12:00:00Z',
        endTime: '1970-01-01T13:00:00Z',
        capacity: 10,
        location: 'Trainer Validation Studio',
      },
    });
    expect([200, 201]).toContain(blockingScheduleResponse.status());

    const outsideHoursUpdateResponse = await adminApi.patch(
      `class-schedule/${primaryScheduleBody.data.id}`,
      {
        data: {
          dayOfWeek: 'TUE',
          startTime: '1970-01-01T10:00:00Z',
          endTime: '1970-01-01T11:00:00Z',
        },
      },
    );
    expect(outsideHoursUpdateResponse.status()).toBe(400);
    expect(getErrorMessage(await outsideHoursUpdateResponse.json())).toContain(
      'Cannot update schedule: Trainer does not work on TUE',
    );

    const overlapUpdateResponse = await adminApi.patch(
      `class-schedule/${primaryScheduleBody.data.id}`,
      {
        data: {
          dayOfWeek: 'MON',
          startTime: '1970-01-01T12:30:00Z',
          endTime: '1970-01-01T13:30:00Z',
        },
      },
    );
    expect(overlapUpdateResponse.status()).toBe(400);
    expect(getErrorMessage(await overlapUpdateResponse.json())).toContain(
      'Conflicting schedule(s):',
    );

    const validUpdateResponse = await adminApi.patch(
      `class-schedule/${primaryScheduleBody.data.id}`,
      {
        data: {
          dayOfWeek: 'MON',
          startTime: '1970-01-01T13:00:00Z',
          endTime: '1970-01-01T14:00:00Z',
          location: 'Trainer Validation Studio - Updated',
        },
      },
    );
    expect(validUpdateResponse.status()).toBe(200);
  });

  test('supports the trainer-client link lifecycle from creation to trainer-facing listing and end', async () => {
    const trainer = await createManagedTrainer('client-link');

    const createLinkResponse = await adminApi.post(
      `trainer/${trainer.user.id}/clients`,
      {
        data: {
          memberId: memberUser.id,
        },
      },
    );
    if (![200, 201].includes(createLinkResponse.status())) {
      throw new Error(
        `Trainer client link create failed (${createLinkResponse.status()}): ${await createLinkResponse.text()}`,
      );
    }

    const createLinkBody = (await createLinkResponse.json()) as {
      data: {
        id: string;
        trainerId: string;
        memberId: string;
        status: TrainerClientLinkStatus;
        member: { email: string };
      };
    };

    expect(createLinkBody.data).toEqual(
      expect.objectContaining({
        trainerId: trainer.user.id,
        memberId: memberUser.id,
        status: TrainerClientLinkStatus.ACTIVE,
      }),
    );
    expect(createLinkBody.data.member.email).toBe(memberUser.email);

    const trainerListResponse = await trainer.api.get('trainer/me/clients');
    expect(trainerListResponse.status()).toBe(200);

    const trainerListBody = (await trainerListResponse.json()) as {
      data: Array<{ id: string; status: TrainerClientLinkStatus }>;
    };
    expect(trainerListBody.data).toHaveLength(1);
    expect(trainerListBody.data[0]).toEqual(
      expect.objectContaining({
        id: createLinkBody.data.id,
        status: TrainerClientLinkStatus.ACTIVE,
      }),
    );

    const duplicateLinkResponse = await adminApi.post(
      `trainer/${trainer.user.id}/clients`,
      {
        data: {
          memberId: memberUser.id,
        },
      },
    );
    expect(duplicateLinkResponse.status()).toBe(409);
    expect(getErrorMessage(await duplicateLinkResponse.json())).toContain(
      'An active trainer-client link already exists for this member',
    );

    const memberListResponse = await memberApi.get('trainer/me/clients');
    expect(memberListResponse.status()).toBe(403);

    const endLinkResponse = await adminApi.patch(
      `trainer/${trainer.user.id}/clients/${createLinkBody.data.id}/end`,
      {
        data: {
          endReason: 'Program completed',
        },
      },
    );
    expect(endLinkResponse.status()).toBe(200);

    const endLinkBody = (await endLinkResponse.json()) as {
      data: {
        status: TrainerClientLinkStatus;
        endReason: string | null;
      };
    };
    expect(endLinkBody.data).toEqual(
      expect.objectContaining({
        status: TrainerClientLinkStatus.ENDED,
        endReason: 'Program completed',
      }),
    );

    const emptyTrainerListResponse = await trainer.api.get('trainer/me/clients');
    expect(emptyTrainerListResponse.status()).toBe(200);

    const emptyTrainerListBody = (await emptyTrainerListResponse.json()) as {
      data: unknown[];
    };
    expect(emptyTrainerListBody.data).toHaveLength(0);

    const secondEndResponse = await adminApi.patch(
      `trainer/${trainer.user.id}/clients/${createLinkBody.data.id}/end`,
      {
        data: {
          endReason: 'Should fail',
        },
      },
    );
    expect(secondEndResponse.status()).toBe(400);
    expect(getErrorMessage(await secondEndResponse.json())).toContain(
      'Only active trainer-client links can be ended',
    );
  });

  test('deletes a trainer and removes availability-backed access to that trainer record', async () => {
    const trainer = await createManagedTrainer('delete-flow');

    const setAvailabilityResponse = await trainer.api.put(
      `trainer/${trainer.user.id}/availability`,
      {
        data: {
          slots: [
            { dayOfWeek: 'MON', startTime: '09:00', endTime: '12:00' },
          ],
        },
      },
    );
    expect(setAvailabilityResponse.status()).toBe(200);

    const beforeDeleteAvailabilityCount = await prisma.trainerAvailability.count({
      where: { trainerId: trainer.user.id },
    });
    expect(beforeDeleteAvailabilityCount).toBeGreaterThan(0);

    const deleteResponse = await adminApi.delete(`trainer/${trainer.user.id}`);
    expect(deleteResponse.status()).toBe(200);

    const deletedAvailabilityCount = await prisma.trainerAvailability.count({
      where: { trainerId: trainer.user.id },
    });
    expect(deletedAvailabilityCount).toBe(0);

    const getDeletedTrainerResponse = await adminApi.get(
      `trainer/${trainer.user.id}`,
    );
    expect(getDeletedTrainerResponse.status()).toBe(404);

    const getDeletedAvailabilityResponse = await memberApi.get(
      `trainer/${trainer.user.id}/availability`,
    );
    expect(getDeletedAvailabilityResponse.status()).toBe(404);
  });

  async function setupBaseFixtures() {
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
    const [adminRole, memberRole] = await Promise.all([
      ensureRole('ADMIN'),
      ensureRole('MEMBER'),
      ensureRole('TRAINER'),
    ]);

    adminUser = await createBaseUser(
      adminEmail,
      'Admin',
      adminRole.id,
      hashedPassword,
    );
    memberUser = await createBaseUser(
      memberEmail,
      'Member',
      memberRole.id,
      hashedPassword,
    );
  }

  async function createBaseUser(
    email: string,
    label: string,
    roleId: string,
    hashedPassword: string,
  ): Promise<TestUser> {
    const user = await prisma.user.create({
      data: {
        firstName: `PW ${label}`,
        lastName: 'Trainer',
        email,
        password: hashedPassword,
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

  async function ensureRole(name: string) {
    return prisma.role.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${name} role`,
      },
    });
  }

  function buildTrainerPayload(
    label: string,
    overrides: TrainerPayloadOverrides = {},
  ) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    return {
      firstName: 'Playwright',
      lastName: `Trainer ${label}`,
      email: `${managedEmailPrefix}-${label}-${suffix}@test.local`,
      password: TEST_PASSWORD,
      status: 'active',
      specialization: 'Strength',
      experienceYears: 5,
      biography: `Trainer profile for ${label}`,
      certifications: ['NASM CPT'],
      areasOfExpertise: ['Strength'],
      ptSessionPrice30: 180000,
      ptSessionPrice60: 300000,
      ptSessionPrice90: 420000,
      ...overrides,
    };
  }

  async function clearPerTestState() {
    await cleanupTrainerArtifacts({
      includeBaseUsers: false,
    });
  }

  async function cleanupSuiteState() {
    await cleanupTrainerArtifacts({
      includeBaseUsers: true,
    });
  }

  async function cleanupTrainerArtifacts(options: { includeBaseUsers: boolean }) {
    const managedUsers = await prisma.user.findMany({
      where: {
        email: {
          startsWith: managedEmailPrefix,
        },
      },
      select: { id: true },
    });

    const baseUsers = options.includeBaseUsers
      ? await prisma.user.findMany({
          where: {
            email: {
              in: [
                adminEmail,
                memberEmail,
              ],
            },
          },
          select: { id: true },
        })
      : [];

    const managedUserIds = managedUsers.map((user) => user.id);
    const baseUserIds = baseUsers.map((user) => user.id);
    const cleanupUserIds = [...managedUserIds, ...baseUserIds];
    const memberIdsForLinks = options.includeBaseUsers
      ? cleanupUserIds
      : memberUser?.id
        ? [memberUser.id]
        : [];

    const suiteClasses = await prisma.gymClass.findMany({
      where: {
        className: {
          startsWith: suiteKey,
        },
      },
      select: { id: true },
    });
    const suiteClassIds = suiteClasses.map((item) => item.id);

    if (suiteClassIds.length > 0) {
      const schedules = await prisma.classSchedule.findMany({
        where: {
          classId: { in: suiteClassIds },
        },
        select: { id: true },
      });
      const scheduleIds = schedules.map((item) => item.id);

      if (scheduleIds.length > 0) {
        await prisma.classBooking.deleteMany({
          where: {
            classScheduleId: { in: scheduleIds },
          },
        });
        await prisma.scheduleException.deleteMany({
          where: {
            scheduleId: { in: scheduleIds },
          },
        });
        await prisma.scheduleDay.deleteMany({
          where: {
            scheduleId: { in: scheduleIds },
          },
        });
        await prisma.classSchedule.deleteMany({
          where: {
            id: { in: scheduleIds },
          },
        });
      }

      await prisma.gymClass.deleteMany({
        where: {
          id: { in: suiteClassIds },
        },
      });
    }

    const trainerLinkFilters: Prisma.TrainerClientLinkWhereInput[] = [];
    if (managedUserIds.length > 0) {
      trainerLinkFilters.push({ trainerId: { in: managedUserIds } });
      trainerLinkFilters.push({ memberId: { in: managedUserIds } });
    }
    if (memberIdsForLinks.length > 0) {
      trainerLinkFilters.push({ memberId: { in: memberIdsForLinks } });
    }
    if (trainerLinkFilters.length > 0) {
      await prisma.trainerClientLink.deleteMany({
        where: {
          OR: trainerLinkFilters,
        },
      });
    }

    if (managedUserIds.length > 0) {
      await prisma.trainerAvailability.deleteMany({
        where: {
          trainerId: { in: managedUserIds },
        },
      });
    }

    if (cleanupUserIds.length > 0) {
      await prisma.session.deleteMany({
        where: {
          userId: { in: cleanupUserIds },
        },
      });
      await prisma.userRole.deleteMany({
        where: {
          userId: { in: cleanupUserIds },
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: cleanupUserIds },
        },
      });
    }
  }
});
