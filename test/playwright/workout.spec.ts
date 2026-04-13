import { DayOfWeek } from '@prisma/client';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createApiContext, loginAs } from './api-helpers';
import {
  cleanupWorkoutApiTestData,
  cleanupWorkoutDomainData,
  disconnectWorkoutDatabase,
  seedWorkoutApiUsers,
  WORKOUT_PREFIX,
  type SeededWorkoutUsers,
} from './workout-helpers';

type ResponseEnvelope<T> = {
  data: T;
  error?: { message?: string | string[] };
  statusCode?: number;
};

type ExerciseView = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  equipmentRequired: string | null;
};

type WorkoutPlanView = {
  id: string;
  title: string;
  visibility: string;
  planItems: Array<{ id: string; exerciseId: string }>;
  assignments?: Array<{ memberId: string }>;
};

type WorkoutSessionSetLogView = {
  exerciseId: string;
  planItemId: string | null;
  isSubstitution: boolean;
};

type WorkoutSessionView = {
  id: string;
  workoutPlanId: string | null;
  workoutPlan: { id: string; title: string } | null;
  isPlanDeleted?: boolean;
  status: string;
  setLogs: WorkoutSessionSetLogView[];
};

test.describe('Workout Playwright API E2E', () => {
  let seededUsers: SeededWorkoutUsers;
  let anonymousApi: APIRequestContext;
  let trainerApi: APIRequestContext;
  let memberApi: APIRequestContext;
  let otherMemberApi: APIRequestContext;

  test.beforeAll(async () => {
    seededUsers = await seedWorkoutApiUsers();
    anonymousApi = await createApiContext();

    const trainerLogin = await loginAs(
      anonymousApi,
      seededUsers.trainer.email,
      seededUsers.trainer.password,
    );
    trainerApi = await createApiContext(trainerLogin.accessToken);

    const memberLogin = await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );
    memberApi = await createApiContext(memberLogin.accessToken);

    const otherMemberLogin = await loginAs(
      anonymousApi,
      seededUsers.otherMember.email,
      seededUsers.otherMember.password,
    );
    otherMemberApi = await createApiContext(otherMemberLogin.accessToken);
  });

  test.afterEach(async () => {
    await cleanupWorkoutDomainData();
  });

  test.afterAll(async () => {
    await Promise.all([
      anonymousApi?.dispose(),
      trainerApi?.dispose(),
      memberApi?.dispose(),
      otherMemberApi?.dispose(),
    ]);
    await cleanupWorkoutApiTestData();
    await disconnectWorkoutDatabase();
  });

  test('allows trainers to manage exercises while members stay read-only', async () => {
    const createdExercise = await createExercise(trainerApi, 'Deadlift');

    const listResponse = await memberApi.get('exercises');
    expect(listResponse.status()).toBe(200);

    const listBody = await getBody<ResponseEnvelope<ExerciseView[]>>(listResponse);
    expect(
      listBody.data.some((exercise) => exercise.id === createdExercise.id),
    ).toBe(true);

    const forbiddenCreate = await memberApi.post('exercises', {
      data: buildExercisePayload('Member Create Attempt'),
    });
    expect(forbiddenCreate.status()).toBe(403);

    const updateResponse = await trainerApi.patch(
      `exercises/${createdExercise.id}`,
      {
        data: {
          description: 'Updated by Playwright',
          equipmentRequired: 'Trap Bar',
        },
      },
    );
    expect(updateResponse.status()).toBe(200);

    const updateBody = await getBody<ResponseEnvelope<ExerciseView>>(updateResponse);
    expect(updateBody.data.description).toBe('Updated by Playwright');
    expect(updateBody.data.equipmentRequired).toBe('Trap Bar');

    const deleteResponse = await trainerApi.delete(
      `exercises/${createdExercise.id}`,
    );
    expect(deleteResponse.status()).toBe(200);

    const listAfterDelete = await memberApi.get('exercises');
    expect(listAfterDelete.status()).toBe(200);

    const listAfterDeleteBody =
      await getBody<ResponseEnvelope<ExerciseView[]>>(listAfterDelete);
    expect(
      listAfterDeleteBody.data.some(
        (exercise) => exercise.id === createdExercise.id,
      ),
    ).toBe(false);
  });

  test('enforces workout plan visibility for assigned, private, and public plans', async () => {
    const exercise = await createExercise(trainerApi, 'Visibility Squat');

    const assignedPlan = await createWorkoutPlan(trainerApi, {
      title: 'Assigned Visibility',
      exerciseId: exercise.id,
      visibility: 'ASSIGNED',
      assignedMemberIds: [seededUsers.member.id],
    });
    const privatePlan = await createWorkoutPlan(trainerApi, {
      title: 'Private Visibility',
      exerciseId: exercise.id,
      visibility: 'PRIVATE',
    });
    const publicPlan = await createWorkoutPlan(trainerApi, {
      title: 'Public Visibility',
      exerciseId: exercise.id,
      visibility: 'PUBLIC',
    });

    const memberList = await memberApi.get('workout-plans');
    expect(memberList.status()).toBe(200);

    const memberListBody =
      await getBody<ResponseEnvelope<WorkoutPlanView[]>>(memberList);
    const memberPlanIds = memberListBody.data.map((plan) => plan.id);
    expect(memberPlanIds).toContain(assignedPlan.id);
    expect(memberPlanIds).toContain(publicPlan.id);
    expect(memberPlanIds).not.toContain(privatePlan.id);

    const otherMemberList = await otherMemberApi.get('workout-plans');
    expect(otherMemberList.status()).toBe(200);

    const otherMemberListBody =
      await getBody<ResponseEnvelope<WorkoutPlanView[]>>(otherMemberList);
    const otherMemberPlanIds = otherMemberListBody.data.map((plan) => plan.id);
    expect(otherMemberPlanIds).toContain(publicPlan.id);
    expect(otherMemberPlanIds).not.toContain(assignedPlan.id);
    expect(otherMemberPlanIds).not.toContain(privatePlan.id);

    const assignedDetailForOtherMember = await otherMemberApi.get(
      `workout-plans/${assignedPlan.id}`,
    );
    expect(assignedDetailForOtherMember.status()).toBe(403);

    const privateDetailForOtherMember = await otherMemberApi.get(
      `workout-plans/${privatePlan.id}`,
    );
    expect(privateDetailForOtherMember.status()).toBe(403);
  });

  test('covers the assigned workout lifecycle, substitution logging, trainer visibility, and deleted-plan history', async () => {
    const prescribedExercise = await createExercise(trainerApi, 'Back Squat');
    const substituteExercise = await createExercise(trainerApi, 'Hack Squat', {
      equipmentRequired: 'Machine',
    });
    const plan = await createWorkoutPlan(trainerApi, {
      title: 'Lifecycle Lower Body',
      exerciseId: prescribedExercise.id,
      visibility: 'ASSIGNED',
      assignedMemberIds: [seededUsers.member.id],
    });

    const session = await startWorkoutSession(memberApi, plan.id);
    expect(session.status).toBe('IN_PROGRESS');

    const plannedSetResponse = await memberApi.post(
      `workout-sessions/${session.id}/sets`,
      {
        data: {
          exerciseId: prescribedExercise.id,
          planItemId: plan.planItems[0].id,
          setNumber: 1,
          actualRep: 5,
          actualWeight: 100,
          rpe: 8,
        },
      },
    );
    expect(plannedSetResponse.status()).toBe(201);

    const substitutedSetResponse = await memberApi.post(
      `workout-sessions/${session.id}/sets`,
      {
        data: {
          exerciseId: substituteExercise.id,
          planItemId: plan.planItems[0].id,
          setNumber: 2,
          actualRep: 6,
          actualWeight: 90,
          rpe: 7,
        },
      },
    );
    expect(substitutedSetResponse.status()).toBe(201);

    const substitutedSetBody =
      await getBody<ResponseEnvelope<WorkoutSessionSetLogView>>(
        substitutedSetResponse,
      );
    expect(substitutedSetBody.data.isSubstitution).toBe(true);

    const completeResponse = await memberApi.patch(
      `workout-sessions/${session.id}/complete`,
      {
        data: {
          endTime: '2026-03-24T09:00:00.000Z',
          notes: 'Completed by Playwright',
        },
      },
    );
    expect(completeResponse.status()).toBe(200);

    const trainerHistory = await trainerApi.get('workout-sessions');
    expect(trainerHistory.status()).toBe(200);

    const trainerHistoryBody =
      await getBody<ResponseEnvelope<WorkoutSessionView[]>>(trainerHistory);
    expect(
      trainerHistoryBody.data.some((item) => item.id === session.id),
    ).toBe(true);

    const historyBeforeDelete = await memberApi.get('workout-sessions');
    expect(historyBeforeDelete.status()).toBe(200);

    const historyBeforeDeleteBody =
      await getBody<ResponseEnvelope<WorkoutSessionView[]>>(historyBeforeDelete);
    const activeSession = requireSession(historyBeforeDeleteBody.data, session.id);
    expect(activeSession.status).toBe('COMPLETED');
    expect(activeSession.workoutPlanId).toBe(plan.id);
    expect(activeSession.setLogs).toHaveLength(2);
    expect(activeSession.setLogs[0].isSubstitution).toBe(false);
    expect(activeSession.setLogs[1].isSubstitution).toBe(true);

    const deletePlanResponse = await trainerApi.delete(
      `workout-plans/${plan.id}`,
    );
    expect(deletePlanResponse.status()).toBe(200);

    const historyAfterDelete = await memberApi.get('workout-sessions');
    expect(historyAfterDelete.status()).toBe(200);

    const historyAfterDeleteBody =
      await getBody<ResponseEnvelope<WorkoutSessionView[]>>(historyAfterDelete);
    const deletedPlanSession = requireSession(
      historyAfterDeleteBody.data,
      session.id,
    );
    expect(deletedPlanSession.workoutPlanId).toBeNull();
    expect(deletedPlanSession.workoutPlan).toBeNull();
    expect(deletedPlanSession.isPlanDeleted).toBe(true);
    expect(deletedPlanSession.setLogs).toHaveLength(2);
    expect(
      deletedPlanSession.setLogs.every((log) => log.planItemId === null),
    ).toBe(true);
  });

  test('supports unstructured workout sessions without a plan or plan item', async () => {
    const freestyleExercise = await createExercise(trainerApi, 'Freestyle Press', {
      equipmentRequired: 'Dumbbell',
    });

    const session = await startWorkoutSession(memberApi);
    expect(session.workoutPlanId).toBeNull();

    const setResponse = await memberApi.post(
      `workout-sessions/${session.id}/sets`,
      {
        data: {
          exerciseId: freestyleExercise.id,
          setNumber: 1,
          actualRep: 12,
          actualWeight: 30,
        },
      },
    );
    expect(setResponse.status()).toBe(201);

    const setBody = await getBody<ResponseEnvelope<WorkoutSessionSetLogView>>(
      setResponse,
    );
    expect(setBody.data.planItemId).toBeNull();
    expect(setBody.data.isSubstitution).toBe(false);

    const completeResponse = await memberApi.patch(
      `workout-sessions/${session.id}/complete`,
      {
        data: {
          endTime: '2026-03-24T10:45:00.000Z',
          notes: 'Freestyle session complete',
        },
      },
    );
    expect(completeResponse.status()).toBe(200);

    const historyResponse = await memberApi.get('workout-sessions');
    expect(historyResponse.status()).toBe(200);

    const historyBody =
      await getBody<ResponseEnvelope<WorkoutSessionView[]>>(historyResponse);
    const freestyleSession = requireSession(historyBody.data, session.id);
    expect(freestyleSession.workoutPlanId).toBeNull();
    expect(freestyleSession.workoutPlan).toBeNull();
    expect(freestyleSession.status).toBe('COMPLETED');
    expect(freestyleSession.setLogs).toHaveLength(1);
    expect(freestyleSession.setLogs[0].planItemId).toBeNull();
  });

  test('rejects cross-user writes and member-forbidden workout mutations', async () => {
    const exercise = await createExercise(trainerApi, 'Cross User Row');
    const plan = await createWorkoutPlan(trainerApi, {
      title: 'Cross User Access',
      exerciseId: exercise.id,
      visibility: 'ASSIGNED',
      assignedMemberIds: [seededUsers.member.id],
    });
    const session = await startWorkoutSession(memberApi, plan.id);

    const crossUserSetResponse = await otherMemberApi.post(
      `workout-sessions/${session.id}/sets`,
      {
        data: {
          exerciseId: exercise.id,
          setNumber: 1,
          actualRep: 5,
          actualWeight: 80,
        },
      },
    );
    expect(crossUserSetResponse.status()).toBe(403);

    const memberDeletePlanResponse = await memberApi.delete(
      `workout-plans/${plan.id}`,
    );
    expect(memberDeletePlanResponse.status()).toBe(403);

    const memberCreatePlanResponse = await memberApi.post('workout-plans', {
      data: {
        title: `${WORKOUT_PREFIX} Member Plan ${createUniqueSuffix()}`,
        duration: 45,
        status: 'ACTIVE',
        visibility: 'PRIVATE',
        planItems: [
          {
            exerciseId: exercise.id,
            sequence: 1,
            targetSet: 3,
            targetRep: 8,
            targetWeight: 40,
            dayOfWeek: DayOfWeek.WED,
          },
        ],
      },
    });
    expect(memberCreatePlanResponse.status()).toBe(403);
  });
});

function buildExercisePayload(
  label: string,
  overrides: Partial<{
    description: string;
    category: string;
    equipmentRequired: string;
  }> = {},
) {
  const suffix = createUniqueSuffix();

  return {
    name: `${WORKOUT_PREFIX} ${label} ${suffix}`,
    description: `Playwright exercise ${suffix}`,
    category: 'Strength',
    equipmentRequired: 'Barbell',
    ...overrides,
  };
}

async function createExercise(
  api: APIRequestContext,
  label: string,
  overrides: Partial<{
    description: string;
    category: string;
    equipmentRequired: string;
  }> = {},
) {
  const response = await api.post('exercises', {
    data: buildExercisePayload(label, overrides),
  });
  expect(response.status()).toBe(201);

  const body = await getBody<ResponseEnvelope<ExerciseView>>(response);
  return body.data;
}

async function createWorkoutPlan(
  api: APIRequestContext,
  options: {
    title: string;
    exerciseId: string;
    visibility: 'ASSIGNED' | 'PRIVATE' | 'PUBLIC';
    assignedMemberIds?: string[];
  },
) {
  const payload: Record<string, unknown> = {
    title: `${WORKOUT_PREFIX} ${options.title} ${createUniqueSuffix()}`,
    duration: 60,
    status: 'ACTIVE',
    visibility: options.visibility,
    planItems: [
      {
        exerciseId: options.exerciseId,
        sequence: 1,
        targetSet: 3,
        targetRep: 5,
        targetWeight: 100,
        dayOfWeek: DayOfWeek.MON,
        notes: 'Playwright workout plan item',
      },
    ],
  };

  if (options.assignedMemberIds && options.assignedMemberIds.length > 0) {
    payload.assignedMemberIds = options.assignedMemberIds;
  }

  const response = await api.post('workout-plans', {
    data: payload,
  });
  expect(response.status()).toBe(201);

  const body = await getBody<ResponseEnvelope<WorkoutPlanView>>(response);
  return body.data;
}

async function startWorkoutSession(
  api: APIRequestContext,
  workoutPlanId?: string,
) {
  const response = await api.post('workout-sessions', {
    data: workoutPlanId
      ? {
          workoutPlanId,
          startTime: '2026-03-24T08:00:00.000Z',
        }
      : {
          startTime: '2026-03-24T10:00:00.000Z',
        },
  });
  expect(response.status()).toBe(201);

  const body = await getBody<ResponseEnvelope<WorkoutSessionView>>(response);
  return body.data;
}

async function getBody<T>(response: { json(): Promise<unknown> }) {
  return (await response.json()) as T;
}

function requireSession(sessions: WorkoutSessionView[], sessionId: string) {
  const session = sessions.find((item) => item.id === sessionId);
  expect(session).toBeDefined();
  return session as WorkoutSessionView;
}

function createUniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
