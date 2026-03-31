import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  authRequest,
  cleanupTestData,
  createTestData,
  getErrorMessage,
  loginAs,
} from './test-helpers';

describe('Diet Module Integration (e2e)', () => {
  const DIET_PREFIX = 'Diet E2E';
  const TRAINER_EMAIL = 'diet-test-trainer@e2e.local';
  const TRAINER_PASSWORD = 'DietTrainerPass@12345';
  const MEMBER_EMAIL = 'diet-test-member@e2e.local';
  const MEMBER_PASSWORD = 'DietMemberPass@12345';
  const OTHER_MEMBER_EMAIL = 'diet-test-member-2@e2e.local';
  const OTHER_MEMBER_PASSWORD = 'DietMemberPass@54321';

  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let trainerToken: string;
  let memberToken: string;
  let otherMemberToken: string;
  let trainerUserId: string;
  let memberUserId: string;
  let otherMemberUserId: string;
  let planId: string;

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
    await cleanup();

    const testData = await createTestData(prisma);
    adminToken = await loginAs(
      app,
      testData.adminUser.email,
      testData.adminPassword,
    );

    const memberRole =
      (await prisma.role.findUnique({ where: { name: 'MEMBER' } })) ??
      (await prisma.role.create({
        data: { name: 'MEMBER', description: 'Member role' },
      }));
    const trainerRole =
      (await prisma.role.findUnique({ where: { name: 'TRAINER' } })) ??
      (await prisma.role.create({
        data: { name: 'TRAINER', description: 'Trainer role' },
      }));

    const hashedPassword = await bcrypt.hash(TRAINER_PASSWORD, 10);
    const trainer = await prisma.user.upsert({
      where: { email: TRAINER_EMAIL },
      update: {
        firstName: 'Diet',
        lastName: 'Trainer',
        password: hashedPassword,
        status: 'active',
      },
      create: {
        firstName: 'Diet',
        lastName: 'Trainer',
        email: TRAINER_EMAIL,
        password: hashedPassword,
        status: 'active',
        userRole: { create: { roleId: trainerRole.id } },
      },
    });
    trainerUserId = trainer.id;

    const memberPasswordHash = await bcrypt.hash(MEMBER_PASSWORD, 10);
    const member = await prisma.user.upsert({
      where: { email: MEMBER_EMAIL },
      update: {
        firstName: 'Diet',
        lastName: 'Member',
        password: memberPasswordHash,
        status: 'active',
      },
      create: {
        firstName: 'Diet',
        lastName: 'Member',
        email: MEMBER_EMAIL,
        password: memberPasswordHash,
        status: 'active',
        userRole: { create: { roleId: memberRole.id } },
      },
    });
    memberUserId = member.id;

    const otherMemberPasswordHash = await bcrypt.hash(
      OTHER_MEMBER_PASSWORD,
      10,
    );
    const otherMember = await prisma.user.upsert({
      where: { email: OTHER_MEMBER_EMAIL },
      update: {
        firstName: 'Diet',
        lastName: 'Other Member',
        password: otherMemberPasswordHash,
        status: 'active',
      },
      create: {
        firstName: 'Diet',
        lastName: 'Other Member',
        email: OTHER_MEMBER_EMAIL,
        password: otherMemberPasswordHash,
        status: 'active',
        userRole: { create: { roleId: memberRole.id } },
      },
    });
    otherMemberUserId = otherMember.id;

    trainerToken = await loginAs(app, TRAINER_EMAIL, TRAINER_PASSWORD);
    memberToken = await loginAs(app, MEMBER_EMAIL, MEMBER_PASSWORD);
    otherMemberToken = await loginAs(
      app,
      OTHER_MEMBER_EMAIL,
      OTHER_MEMBER_PASSWORD,
    );

    await cleanup();
  }, 60000);

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup();
      await cleanupTestData(prisma);
      await prisma.session.deleteMany({
        where: {
          user: {
            email: { in: [TRAINER_EMAIL, MEMBER_EMAIL, OTHER_MEMBER_EMAIL] },
          },
        },
      });
      await prisma.userRole.deleteMany({
        where: {
          user: {
            email: { in: [TRAINER_EMAIL, MEMBER_EMAIL, OTHER_MEMBER_EMAIL] },
          },
        },
      });
      await prisma.user.deleteMany({
        where: {
          email: { in: [TRAINER_EMAIL, MEMBER_EMAIL, OTHER_MEMBER_EMAIL] },
        },
      });
      await prisma.$disconnect();
    }

    if (app) {
      await app.close();
    }
  });

  async function cleanup() {
    if (!prisma) {
      return;
    }

    await prisma.dietPlanAssignment.deleteMany({
      where: {
        dietPlan: {
          title: { startsWith: DIET_PREFIX },
        },
      },
    });

    await prisma.dietPlanMeal.deleteMany({
      where: {
        dietPlan: {
          title: { startsWith: DIET_PREFIX },
        },
      },
    });

    await prisma.dietPlan.deleteMany({
      where: {
        title: { startsWith: DIET_PREFIX },
      },
    });

    await prisma.trainerClientLink.deleteMany({
      where: {
        trainer: {
          email: { in: [TRAINER_EMAIL] },
        },
        member: {
          email: { in: [MEMBER_EMAIL, OTHER_MEMBER_EMAIL] },
        },
      },
    });
  }

  function authFor(token: string) {
    return authRequest(app, token);
  }

  async function createTrainerClientLink(memberId: string) {
    const response = await supertest
      .default(app.getHttpServer())
      .post(`/trainer/${trainerUserId}/clients`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ memberId });

    expect([200, 201]).toContain(response.status);
    return response.body.data.id as string;
  }

  async function createDietPlan(overrides: Record<string, unknown> = {}) {
    const response = await authFor(trainerToken).post('/diet-plans').send({
      title: `${DIET_PREFIX} Lean Bulk`,
      description: 'Daily nutrition guidance',
      durationDays: 30,
      calorieTarget: 2400,
      meals: [
        {
          sequence: 1,
          mealType: 'BREAKFAST',
          mealTitle: 'Breakfast',
          scheduledTime: '07:30:00',
          foodItemsText: 'Oats, eggs, banana',
          calories: 520,
          proteinGrams: 35,
          carbsGrams: 55,
          fatGrams: 18,
        },
      ],
      ...overrides,
    });

    expect(response.status).toBe(201);
    return response.body.data;
  }

  function getTodayIsoDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function getTomorrowIsoDate() {
    return new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  it('allows trainer-client assignment, member reads own plan, and last assignment auto-archives', async () => {
    await createTrainerClientLink(memberUserId);
    const createdPlan = await createDietPlan();
    planId = createdPlan.id;
    expect(createdPlan.status).toBe('DRAFT');
    expect(createdPlan.visibility).toBe('PRIVATE');
    expect(createdPlan.assignments).toHaveLength(0);
    expect(createdPlan.meals).toHaveLength(1);

    const activateResponse = await authFor(trainerToken).patch(
      `/diet-plans/${planId}`,
    ).send({
      status: 'ACTIVE',
      title: `${DIET_PREFIX} Lean Bulk v2`,
    });
    expect(activateResponse.status).toBe(200);
    expect(activateResponse.body.data.status).toBe('ACTIVE');
    expect(activateResponse.body.data.visibility).toBe('PRIVATE');

    const assignResponse = await authFor(trainerToken).post(
      `/diet-plans/${planId}/assignments`,
    ).send({
      assignments: [
        {
          memberId: memberUserId,
          effectiveFrom: getTodayIsoDate(),
        },
      ],
    });
    expect(assignResponse.status).toBe(201);
    expect(assignResponse.body.data.status).toBe('ACTIVE');
    expect(assignResponse.body.data.visibility).toBe('ASSIGNED');
    expect(assignResponse.body.data.assignmentCounts.active).toBe(1);
    expect(assignResponse.body.data.assignments).toHaveLength(1);

    const memberDetail = await authFor(memberToken).get(`/diet-plans/${planId}`);
    expect(memberDetail.status).toBe(200);
    expect(memberDetail.body.data.status).toBe('ACTIVE');
    expect(memberDetail.body.data.visibility).toBe('ASSIGNED');
    expect(memberDetail.body.data.assignments).toHaveLength(1);
    expect(memberDetail.body.data.assignments[0].memberId).toBe(memberUserId);

    const listResponse = await authFor(memberToken).get('/diet-plans');
    expect(listResponse.status).toBe(200);
    const listedPlan = listResponse.body.data.docs.find(
      (doc: { id: string }) => doc.id === planId,
    );
    if (!listedPlan) {
      throw new Error(`Expected member list to include plan ${planId}`);
    }
    expect(listedPlan.visibility).toBe('ASSIGNED');

    const endResponse = await authFor(trainerToken).patch(
      `/diet-plans/${planId}/assignments/${memberDetail.body.data.assignments[0].id}`,
    ).send({
      status: 'ENDED',
      effectiveTo: getTodayIsoDate(),
      endReason: 'Program completed',
    });
    expect(endResponse.status).toBe(200);
    expect(endResponse.body.data.status).toBe('ARCHIVED');
    expect(endResponse.body.data.visibility).toBe('ASSIGNED');
  });

  it('rejects direct patching into assigned visibility before bootstrap', async () => {
    const createdPlan = await createDietPlan();

    const response = await authFor(trainerToken).patch(
      `/diet-plans/${createdPlan.id}`,
    ).send({
      status: 'ASSIGNED',
    });

    expect(response.status).toBe(400);
    expect(getErrorMessage(response.body)).toContain(
      'status must be one of the following values: DRAFT, ACTIVE, ARCHIVED',
    );
  });

  it('rejects future-dated assignments', async () => {
    await createTrainerClientLink(memberUserId);
    const createdPlan = await createDietPlan();

    await authFor(trainerToken).patch(`/diet-plans/${createdPlan.id}`).send({
      status: 'ACTIVE',
    });

    const response = await authFor(trainerToken).post(
      `/diet-plans/${createdPlan.id}/assignments`,
    ).send({
      assignments: [
        {
          memberId: memberUserId,
          effectiveFrom: getTomorrowIsoDate(),
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(getErrorMessage(response.body)).toContain(
      'cannot start in the future',
    );
  });

  it('rejects in-place edits after the first assignment', async () => {
    await createTrainerClientLink(memberUserId);
    const createdPlan = await createDietPlan();

    await authFor(trainerToken).patch(`/diet-plans/${createdPlan.id}`).send({
      status: 'ACTIVE',
    });

    await authFor(trainerToken).post(
      `/diet-plans/${createdPlan.id}/assignments`,
    ).send({
      assignments: [
        {
          memberId: memberUserId,
          effectiveFrom: new Date().toISOString().slice(0, 10),
        },
      ],
    });

    const response = await authFor(trainerToken).patch(
      `/diet-plans/${createdPlan.id}`,
    ).send({
      title: `${DIET_PREFIX} Updated After Assignment`,
    });

    expect(response.status).toBe(400);
    expect(getErrorMessage(response.body)).toContain(
      'immutable after the first assignment',
    );
  });

  it('clones an assigned plan into a new draft private successor with copied meals', async () => {
    await createTrainerClientLink(memberUserId);
    const createdPlan = await createDietPlan({
      title: `${DIET_PREFIX} Clone Source`,
      meals: [
        {
          sequence: 1,
          mealType: 'BREAKFAST',
          mealTitle: 'Breakfast',
          scheduledTime: '07:30:00',
          foodItemsText: 'Oats, eggs, banana',
          calories: 520,
          proteinGrams: 35,
          carbsGrams: 55,
          fatGrams: 18,
        },
        {
          sequence: 2,
          mealType: 'LUNCH',
          mealTitle: 'Lunch',
          scheduledTime: '12:30:00',
          foodItemsText: 'Chicken, rice, vegetables',
          calories: 710,
          proteinGrams: 52,
          carbsGrams: 68,
          fatGrams: 19,
        },
      ],
    });

    await authFor(trainerToken).patch(`/diet-plans/${createdPlan.id}`).send({
      status: 'ACTIVE',
    });

    await authFor(trainerToken).post(
      `/diet-plans/${createdPlan.id}/assignments`,
    ).send({
      assignments: [
        {
          memberId: memberUserId,
          effectiveFrom: getTodayIsoDate(),
        },
      ],
    });

    const response = await authFor(trainerToken).post(
      `/diet-plans/${createdPlan.id}/clone`,
    );

    expect([200, 201]).toContain(response.status);
    expect(response.body.data.id).not.toBe(createdPlan.id);
    expect(response.body.data.status).toBe('DRAFT');
    expect(response.body.data.visibility).toBe('PRIVATE');
    expect(response.body.data.assignments).toHaveLength(0);
    expect(response.body.data.meals).toHaveLength(createdPlan.meals.length);
    expect(
      response.body.data.meals.map(
        (meal: { sequence: number; mealTitle: string; mealType: string }) => ({
          sequence: meal.sequence,
          mealTitle: meal.mealTitle,
          mealType: meal.mealType,
        }),
      ),
    ).toEqual([
      {
        sequence: 1,
        mealTitle: 'Breakfast',
        mealType: 'BREAKFAST',
      },
      {
        sequence: 2,
        mealTitle: 'Lunch',
        mealType: 'LUNCH',
      },
    ]);
  });

  it('rejects assignment of an unrelated member', async () => {
    await createTrainerClientLink(memberUserId);
    const plan = await createDietPlan();

    await authFor(trainerToken).patch(`/diet-plans/${plan.id}`).send({
      status: 'ACTIVE',
    });

    const response = await authFor(trainerToken).post(
      `/diet-plans/${plan.id}/assignments`,
    ).send({
      assignments: [
        {
          memberId: otherMemberUserId,
          effectiveFrom: getTodayIsoDate(),
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(getErrorMessage(response.body)).toContain('trainer-client link');
  });

  it('supports private plan archival and deletion for unused drafts', async () => {
    const plan = await createDietPlan();

    const archiveResponse = await authFor(trainerToken).post(
      `/diet-plans/${plan.id}/archive`,
    );
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body.data.status).toBe('ARCHIVED');

    const draftPlan = await createDietPlan();
    const deleteResponse = await authFor(trainerToken).delete(
      `/diet-plans/${draftPlan.id}`,
    );
    expect(deleteResponse.status).toBe(200);
  });

  it('returns only self-scoped member history when includeArchived is enabled', async () => {
    await createTrainerClientLink(memberUserId);
    const plan = await createDietPlan();

    await authFor(trainerToken).patch(`/diet-plans/${plan.id}`).send({
      status: 'ACTIVE',
    });

    const assignResponse = await authFor(trainerToken).post(
      `/diet-plans/${plan.id}/assignments`,
    ).send({
      assignments: [
        {
          memberId: memberUserId,
          effectiveFrom: getTodayIsoDate(),
        },
      ],
    });

    const assignmentId = assignResponse.body.data.assignments[0].id as string;

    await authFor(trainerToken).patch(
      `/diet-plans/${plan.id}/assignments/${assignmentId}`,
    ).send({
      status: 'ENDED',
      effectiveTo: getTodayIsoDate(),
      endReason: 'Archived for history test',
    });

    const defaultList = await authFor(memberToken).get('/diet-plans');
    expect(defaultList.status).toBe(200);
    expect(
      defaultList.body.data.docs.some(
        (doc: { id: string }) => doc.id === plan.id,
      ),
    ).toBe(false);

    const archivedList = await authFor(memberToken).get(
      '/diet-plans?includeArchived=true',
    );
    expect(archivedList.status).toBe(200);
    const archivedPlan = archivedList.body.data.docs.find(
      (doc: { id: string }) => doc.id === plan.id,
    );
    if (!archivedPlan) {
      throw new Error(`Expected archived history list to include plan ${plan.id}`);
    }
    expect(archivedPlan.assignments).toHaveLength(1);
    expect(archivedPlan.assignments[0].memberId).toBe(
      memberUserId,
    );
  });

  it('rejects other members from reading an assigned plan detail', async () => {
    await createTrainerClientLink(memberUserId);
    const plan = await createDietPlan();

    await authFor(trainerToken).patch(`/diet-plans/${plan.id}`).send({
      status: 'ACTIVE',
    });

    await authFor(trainerToken).post(`/diet-plans/${plan.id}/assignments`).send({
      assignments: [
        {
          memberId: memberUserId,
          effectiveFrom: getTodayIsoDate(),
        },
      ],
    });

    const response = await authFor(otherMemberToken).get(`/diet-plans/${plan.id}`);
    expect(response.status).toBe(403);
    expect(getErrorMessage(response.body)).toContain('access');
  });
});
