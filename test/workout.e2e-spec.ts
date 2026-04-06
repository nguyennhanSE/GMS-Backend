import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { DayOfWeek } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';
import {
  authRequest,
  cleanupTestData,
  createTestData,
  getErrorMessage,
  loginAs,
} from './test-helpers';

describe('Workout Module Integration (e2e)', () => {
  const WORKOUT_PREFIX = 'Workout E2E';
  const SECONDARY_MEMBER_EMAIL = 'api-test-workout-member-2@test.local';
  const SECONDARY_MEMBER_PASSWORD = 'WorkoutPass@12345';

  let app: INestApplication;
  let prisma: PrismaService;
  let trainerToken: string;
  let memberToken: string;
  let otherMemberToken: string;
  let workoutTestData: Awaited<ReturnType<typeof createTestData>>;
  let secondaryMemberId: string;

  const storageServiceMock = {
    uploadUserAvatar: jest.fn(),
    deleteObject: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(storageServiceMock)
      .compile();

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

    workoutTestData = await createTestData(prisma);
    trainerToken = await loginAs(
      app,
      workoutTestData.trainerUser.email,
      workoutTestData.trainerPassword,
    );
    memberToken = await loginAs(
      app,
      workoutTestData.memberUser.email,
      workoutTestData.memberPassword,
    );

    const memberRole =
      (await prisma.role.findUnique({ where: { name: 'MEMBER' } })) ??
      (await prisma.role.create({
        data: { name: 'MEMBER', description: 'Member role' },
      }));

    const hashedPassword = await bcrypt.hash(SECONDARY_MEMBER_PASSWORD, 10);
    const secondaryMember = await prisma.user.upsert({
      where: { email: SECONDARY_MEMBER_EMAIL },
      update: {
        password: hashedPassword,
        firstName: 'Workout',
        lastName: 'Member Two',
        status: 'active',
      },
      create: {
        firstName: 'Workout',
        lastName: 'Member Two',
        email: SECONDARY_MEMBER_EMAIL,
        password: hashedPassword,
        status: 'active',
        userRole: {
          create: { roleId: memberRole.id },
        },
      },
    });
    secondaryMemberId = secondaryMember.id;
    await prisma.userRole.deleteMany({
      where: {
        userId: secondaryMemberId,
      },
    });
    await prisma.userRole.create({
      data: {
        userId: secondaryMemberId,
        roleId: memberRole.id,
      },
    });
    otherMemberToken = await loginAs(
      app,
      SECONDARY_MEMBER_EMAIL,
      SECONDARY_MEMBER_PASSWORD,
    );

    await cleanupWorkoutData();
  }, 60000);

  afterEach(async () => {
    await cleanupWorkoutData();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupWorkoutData();

      await prisma.session.deleteMany({
        where: {
          user: {
            email: SECONDARY_MEMBER_EMAIL,
          },
        },
      });
      await prisma.userRole.deleteMany({
        where: {
          user: {
            email: SECONDARY_MEMBER_EMAIL,
          },
        },
      });
      await prisma.user.deleteMany({
        where: {
          email: SECONDARY_MEMBER_EMAIL,
        },
      });

      await cleanupTestData(prisma);
      await prisma.$disconnect();
    }

    if (app) {
      await app.close();
    }
  });

  async function cleanupWorkoutData() {
    if (!prisma) {
      return;
    }

    await prisma.workoutSession.deleteMany({
      where: {
        memberId: {
          in: [workoutTestData?.memberUser.id, secondaryMemberId].filter(
            Boolean,
          ),
        },
      },
    });

    if (workoutTestData?.trainerUser.id) {
      await prisma.workoutPlan.deleteMany({
        where: {
          trainerId: workoutTestData.trainerUser.id,
        },
      });
    }

    await prisma.exercise.deleteMany({
      where: {
        name: {
          startsWith: WORKOUT_PREFIX,
        },
      },
    });
  }

  async function createWorkoutFlowFixture(options?: { completeSession?: boolean }) {
    const completeSession = options?.completeSession ?? true;

    const [prescribedExercise, substituteExercise] = await Promise.all([
      prisma.exercise.create({
        data: {
          name: `${WORKOUT_PREFIX} Back Squat`,
          description: 'Primary squat pattern',
          category: 'Strength',
          equipmentRequired: 'Barbell',
        },
      }),
      prisma.exercise.create({
        data: {
          name: `${WORKOUT_PREFIX} Hack Squat`,
          description: 'Substitute squat pattern',
          category: 'Strength',
          equipmentRequired: 'Machine',
        },
      }),
    ]);

    const planResponse = await authRequest(app, trainerToken)
      .post('/workout-plans')
      .send({
        title: `${WORKOUT_PREFIX} Lower Body`,
        duration: 60,
        status: 'ACTIVE',
        visibility: 'ASSIGNED',
        assignedMemberIds: [workoutTestData.memberUser.id],
        planItems: [
          {
            exerciseId: prescribedExercise.id,
            sequence: 1,
            targetSet: 3,
            targetRep: 5,
            targetWeight: 100,
            dayOfWeek: DayOfWeek.MON,
            notes: 'Primary strength work',
          },
        ],
      });

    expect(planResponse.status).toBe(201);
    expect(planResponse.body.data.title).toBe(`${WORKOUT_PREFIX} Lower Body`);
    expect(planResponse.body.data.assignments).toHaveLength(1);
    expect(planResponse.body.data.assignments[0].memberId).toBe(
      workoutTestData.memberUser.id,
    );

    const planId = planResponse.body.data.id as string;
    const planItemId = planResponse.body.data.planItems[0].id as string;

    const sessionResponse = await authRequest(app, memberToken)
      .post('/workout-sessions')
      .send({
        workoutPlanId: planId,
        startTime: '2026-03-24T08:00:00.000Z',
      });

    expect(sessionResponse.status).toBe(201);
    expect(sessionResponse.body.data.status).toBe('IN_PROGRESS');

    const sessionId = sessionResponse.body.data.id as string;

    const setResponse = await authRequest(app, memberToken)
      .post(`/workout-sessions/${sessionId}/sets`)
      .send({
        exerciseId: prescribedExercise.id,
        planItemId,
        setNumber: 1,
        actualRep: 5,
        actualWeight: 100,
        rpe: 8,
      });

    expect(setResponse.status).toBe(201);
    expect(setResponse.body.data.exerciseId).toBe(prescribedExercise.id);
    expect(setResponse.body.data.planItemId).toBe(planItemId);

    if (completeSession) {
      const completeResponse = await authRequest(app, memberToken)
        .patch(`/workout-sessions/${sessionId}/complete`)
        .send({
          endTime: '2026-03-24T09:00:00.000Z',
          notes: 'Session complete',
        });

      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.data.status).toBe('COMPLETED');
    }

    return {
      planId,
      planItemId,
      sessionId,
      prescribedExerciseId: prescribedExercise.id,
      substituteExerciseId: substituteExercise.id,
    };
  }

  it('supports the full workout flow and keeps deleted history null-safe', async () => {
    const fixture = await createWorkoutFlowFixture();

    const deleteResponse = await authRequest(app, trainerToken).delete(
      `/workout-plans/${fixture.planId}`,
    );

    expect(deleteResponse.status).toBe(200);

    const historyResponse = await authRequest(app, memberToken).get(
      '/workout-sessions',
    );

    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.data).toHaveLength(1);

    const session = historyResponse.body.data[0];
    expect(session.id).toBe(fixture.sessionId);
    expect(session.workoutPlanId).toBeNull();
    expect(session.workoutPlan).toBeNull();
    expect(session.isPlanDeleted).toBe(true);
    expect(session.setLogs).toHaveLength(1);
    expect(session.setLogs[0].exerciseId).toBe(fixture.prescribedExerciseId);
    expect(session.setLogs[0].planItemId).toBeNull();
    expect(session.setLogs[0].isSubstitution).toBe(false);
  });

  it('flags substituted sets when a member logs a different exercise than the plan item', async () => {
    const fixture = await createWorkoutFlowFixture({ completeSession: false });

    const setResponse = await authRequest(app, memberToken)
      .post(`/workout-sessions/${fixture.sessionId}/sets`)
      .send({
        exerciseId: fixture.substituteExerciseId,
        planItemId: fixture.planItemId,
        setNumber: 2,
        actualRep: 6,
        actualWeight: 90,
        rpe: 7,
      });

    expect(setResponse.status).toBe(201);
    expect(setResponse.body.data.exerciseId).toBe(fixture.substituteExerciseId);
    expect(setResponse.body.data.planItemId).toBe(fixture.planItemId);
    expect(setResponse.body.data.isSubstitution).toBe(true);

    const historyResponse = await authRequest(app, memberToken).get(
      '/workout-sessions',
    );

    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.data).toHaveLength(1);
    expect(historyResponse.body.data[0].setLogs).toHaveLength(2);
    expect(historyResponse.body.data[0].setLogs[1].isSubstitution).toBe(true);
  });

  it('supports unstructured workouts without a plan or plan item', async () => {
    const freestyleExercise = await prisma.exercise.create({
      data: {
        name: `${WORKOUT_PREFIX} Freestyle Press`,
        description: 'Unstructured workout exercise',
        category: 'Strength',
        equipmentRequired: 'Dumbbell',
      },
    });

    const sessionResponse = await authRequest(app, memberToken)
      .post('/workout-sessions')
      .send({
        startTime: '2026-03-24T10:00:00.000Z',
      });

    expect(sessionResponse.status).toBe(201);
    expect(sessionResponse.body.data.workoutPlanId).toBeNull();
    expect(sessionResponse.body.data.status).toBe('IN_PROGRESS');

    const sessionId = sessionResponse.body.data.id as string;

    const setResponse = await authRequest(app, memberToken)
      .post(`/workout-sessions/${sessionId}/sets`)
      .send({
        exerciseId: freestyleExercise.id,
        setNumber: 1,
        actualRep: 12,
        actualWeight: 30,
      });

    expect(setResponse.status).toBe(201);
    expect(setResponse.body.data.planItemId).toBeNull();
    expect(setResponse.body.data.isSubstitution).toBe(false);

    const completeResponse = await authRequest(app, memberToken)
      .patch(`/workout-sessions/${sessionId}/complete`)
      .send({
        endTime: '2026-03-24T10:45:00.000Z',
        notes: 'Freestyle session complete',
      });

    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body.data.status).toBe('COMPLETED');
  });

  it('rejects invalid set payloads at the API boundary', async () => {
    const fixture = await createWorkoutFlowFixture();

    const invalidResponse = await authRequest(app, memberToken)
      .post(`/workout-sessions/${fixture.sessionId}/sets`)
      .send({
        exerciseId: fixture.prescribedExerciseId,
        planItemId: fixture.planItemId,
        setNumber: 1,
        actualRep: 5,
        actualWeight: -50,
        rpe: 15,
      });

    expect(invalidResponse.status).toBe(400);
    expect(getErrorMessage(invalidResponse.body)).toContain('actualWeight');
    expect(getErrorMessage(invalidResponse.body)).toContain('rpe');
  });

  it('forbids members from creating exercises or deleting workout plans', async () => {
    const fixture = await createWorkoutFlowFixture();

    const createExerciseResponse = await authRequest(app, memberToken)
      .post('/exercises')
      .send({
        name: `${WORKOUT_PREFIX} Member Exercise`,
        category: 'Strength',
        equipmentRequired: 'Barbell',
        description: 'Should not be created by a member',
      });

    expect(createExerciseResponse.status).toBe(403);

    const deletePlanResponse = await authRequest(app, memberToken).delete(
      `/workout-plans/${fixture.planId}`,
    );

    expect(deletePlanResponse.status).toBe(403);
  });

  it('rejects cross-user set insertion with a forbidden response', async () => {
    const fixture = await createWorkoutFlowFixture({ completeSession: false });

    const crossUserResponse = await authRequest(app, otherMemberToken)
      .post(`/workout-sessions/${fixture.sessionId}/sets`)
      .send({
        exerciseId: fixture.prescribedExerciseId,
        setNumber: 1,
        actualRep: 5,
        actualWeight: 80,
      });

    expect(crossUserResponse.status).toBe(403);
    expect(getErrorMessage(crossUserResponse.body)).toContain(
      'own workout sessions',
    );
  });
});
