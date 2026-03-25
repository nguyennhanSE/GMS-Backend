import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as supertest from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Trainer Module Integration Tests (e2e)
 *
 * Uses real DB (Prisma).
 * Tests the trainer CRUD + availability CRUD + isWithinWorkingHours integration.
 *
 * Covers:
 * 1. Trainer CRUD (create with admin-provided password, get, update, delete)
 * 2. Availability CRUD (set, get, delete slot)
 * 3. Working hours validation via ClassSchedule creation
 */
describe('Trainer Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const ADMIN_EMAIL = 'trainer-test-admin@e2e.local';
  const ADMIN_PASSWORD = 'AdminPass@12345';
  const TRAINER_EMAIL = 'trainer-test-user@e2e.local';
  const TRAINER_PASSWORD = 'TrainerPass@12345';

  let adminUserId: string;
  let trainerUserId: string;

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

    // Clean up first
    await cleanup(prisma);

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // Ensure ADMIN role exists
    let adminRole = await prisma.role.findFirst({ where: { name: 'ADMIN' } });
    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: { name: 'ADMIN', description: 'Admin role' },
      });
    }

    // Ensure TRAINER role exists
    let trainerRole = await prisma.role.findFirst({
      where: { name: 'TRAINER' },
    });
    if (!trainerRole) {
      trainerRole = await prisma.role.create({
        data: { name: 'TRAINER', description: 'Trainer role' },
      });
    }

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Admin',
        email: ADMIN_EMAIL,
        password: hashedPassword,
        status: 'active',
        userRole: { create: { roleId: adminRole.id } },
      },
    });
    adminUserId = admin.id;

    // Login as admin to get token
    const loginRes = await supertest
      .default(app.getHttpServer())
      .post('/auth/login')
      .send({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    adminToken = loginRes.body?.data?.accessToken;
  }, 60000);

  afterAll(async () => {
    if (prisma) await cleanup(prisma);
    if (app) await app.close();
  });

  async function cleanup(p: PrismaService) {
    const emails = [ADMIN_EMAIL, TRAINER_EMAIL];

    // Clean in FK order
    await p.trainerAvailability.deleteMany({
      where: { trainer: { email: { in: emails } } },
    });
    await p.scheduleDay.deleteMany({
      where: {
        schedule: { trainer: { email: { in: emails } } },
      },
    });
    await p.classSchedule.deleteMany({
      where: { trainer: { email: { in: emails } } },
    });
    await p.session.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await p.userRole.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await p.user.deleteMany({
      where: { email: { in: emails } },
    });
  }

  /** Helper: POST with admin token */
  function adminPost(path: string) {
    return supertest
      .default(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  /** Helper: GET with admin token */
  function adminGet(path: string) {
    return supertest
      .default(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  /** Helper: PUT with admin token */
  function adminPut(path: string) {
    return supertest
      .default(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  /** Helper: PATCH with admin token */
  function adminPatch(path: string) {
    return supertest
      .default(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  /** Helper: DELETE with admin token */
  function adminDelete(path: string) {
    return supertest
      .default(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  // ─── Scope 1: Trainer CRUD ─────────────────────────────────────────

  describe('Trainer CRUD', () => {
    it('[T1] should create trainer with admin-provided password', async () => {
      const res = await adminPost('/trainer/create').send({
        firstName: 'Test',
        lastName: 'Trainer',
        email: TRAINER_EMAIL,
        password: TRAINER_PASSWORD,
      });

      // May be 201 or 200 depending on controller response code
      expect([200, 201]).toContain(res.status);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.email).toBe(TRAINER_EMAIL);
      // Password should NOT be in response
      expect(res.body.data.password).toBeUndefined();
      trainerUserId = res.body.data.id;

      const roles = await prisma.userRole.findMany({
        where: { userId: trainerUserId },
        include: { role: true },
      });
      expect(roles.map((item) => item.role.name)).toEqual(['TRAINER']);
    });

    it('[T2] trainer should be able to login with admin-set password', async () => {
      // Activate the trainer first (create sets no status by default)
      await prisma.user.update({
        where: { id: trainerUserId },
        data: { status: 'active' },
      });

      const res = await supertest
        .default(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TRAINER_EMAIL, password: TRAINER_PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('[T3] should reject trainer create requests that try to set role', async () => {
      const res = await adminPost('/trainer/create').send({
        firstName: 'Role',
        lastName: 'Override',
        email: 'trainer-role-override@e2e.local',
        password: 'RolePass@12345',
        role: 'ADMIN',
      });

      expect(res.status).toBe(400);
      expect(
        Array.isArray(res.body?.message)
          ? res.body.message.join(' ')
          : String(res.body?.message ?? res.body?.error?.message ?? ''),
      ).toContain('role should not exist');
    });

    it('[T4] should reject creating trainer with short password', async () => {
      const res = await adminPost('/trainer/create').send({
        firstName: 'Bad',
        lastName: 'Pass',
        email: 'short-pass@e2e.local',
        password: 'short',
      });

      expect(res.status).toBe(400);
    });

    it('[T5] should reject duplicate email', async () => {
      const res = await adminPost('/trainer/create').send({
        firstName: 'Dup',
        lastName: 'Email',
        email: TRAINER_EMAIL,
        password: 'DuplicatePass@123',
      });

      expect(res.status).toBe(400);
    });

    it('[T6] should get trainer by ID', async () => {
      const res = await adminGet(`/trainer/${trainerUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(TRAINER_EMAIL);
    });

    it('[T7] should update trainer', async () => {
      const res = await adminPatch(`/trainer/${trainerUserId}`).send({
        firstName: 'Updated',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Updated');
    });
  });

  // ─── Scope 2: Availability CRUD ──────────────────────────────────

  describe('Availability CRUD', () => {
    it('[T8] should set trainer availability (bulk)', async () => {
      const res = await adminPut(
        `/trainer/${trainerUserId}/availability`,
      ).send({
        slots: [
          { dayOfWeek: 'MON', startTime: '09:00', endTime: '12:00' },
          { dayOfWeek: 'MON', startTime: '14:00', endTime: '18:00' },
          { dayOfWeek: 'WED', startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 'FRI', startTime: '09:00', endTime: '12:00' },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.data.availability).toBeDefined();
      expect(res.body.data.availability.length).toBe(4);
    });

    it('[T9] should get trainer availability', async () => {
      const res = await adminGet(
        `/trainer/${trainerUserId}/availability`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.availability).toBeDefined();
      expect(res.body.data.availability.length).toBe(4);
      expect(res.body.data.trainerId).toBe(trainerUserId);
    });

    it('[T10] should replace availability on re-set', async () => {
      // Set new availability (should replace all existing)
      const res = await adminPut(
        `/trainer/${trainerUserId}/availability`,
      ).send({
        slots: [
          { dayOfWeek: 'TUE', startTime: '10:00', endTime: '16:00' },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.data.availability.length).toBe(1);

      // Verify old slots are gone
      const getRes = await adminGet(
        `/trainer/${trainerUserId}/availability`,
      );
      expect(getRes.body.data.availability.length).toBe(1);
    });

    it('[T11] should delete a single availability slot', async () => {
      // First set some slots
      await adminPut(`/trainer/${trainerUserId}/availability`).send({
        slots: [
          { dayOfWeek: 'MON', startTime: '09:00', endTime: '12:00' },
          { dayOfWeek: 'WED', startTime: '09:00', endTime: '17:00' },
        ],
      });

      // Get slots to find an ID
      const getRes = await adminGet(
        `/trainer/${trainerUserId}/availability`,
      );
      const slotId = getRes.body.data.availability[0].id;

      // Delete single slot
      const delRes = await adminDelete(
        `/trainer/${trainerUserId}/availability/${slotId}`,
      );
      expect(delRes.status).toBe(200);

      // Verify only 1 slot remains
      const afterRes = await adminGet(
        `/trainer/${trainerUserId}/availability`,
      );
      expect(afterRes.body.data.availability.length).toBe(1);
    });

    it('[T12] should return 404 for non-existent trainer', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await adminGet(`/trainer/${fakeId}/availability`);

      expect(res.status).toBe(404);
    });
  });

  // ─── Scope 3: Two-Layer Availability Check (Cross-Module) ─────────

  describe('Two-Layer Availability Check', () => {
    let testClassId: string;

    beforeAll(async () => {
      // Set trainer availability: ONLY Monday 09:00-17:00
      await adminPut(`/trainer/${trainerUserId}/availability`).send({
        slots: [
          { dayOfWeek: 'MON', startTime: '09:00', endTime: '17:00' },
        ],
      });

      // Create a gym class for testing
      const gymClass = await prisma.gymClass.create({
        data: {
          className: 'Trainer E2E Test Class',
          description: 'Test class for two-layer check',
          difficultyLevel: 'Beginner',
          category: 'Testing',
          isActive: true,
        },
      });
      testClassId = gymClass.id;
    });

    afterAll(async () => {
      // Clean up test class and schedules
      await prisma.scheduleDay.deleteMany({
        where: {
          schedule: { gymClass: { className: 'Trainer E2E Test Class' } },
        },
      });
      await prisma.classSchedule.deleteMany({
        where: { gymClass: { className: 'Trainer E2E Test Class' } },
      });
      await prisma.gymClass.deleteMany({
        where: { className: 'Trainer E2E Test Class' },
      });
    });

    it('[T13] Layer 1: should REJECT schedule outside working hours (trainer has no TUE availability)', async () => {
      // Arrange: trainer is available MON 09:00-17:00, NOT Tuesday
      // Act: try to create a schedule on TUESDAY
      const res = await adminPost('/class-schedule/create').send({
        classId: testClassId,
        trainerId: trainerUserId,
        dayOfWeek: 'TUE',
        startTime: '1970-01-01T10:00:00Z',
        endTime: '1970-01-01T11:00:00Z',
        capacity: 20,
        location: 'Studio A',
      });

      // Assert: should be rejected by Layer 1 (working hours check)
      expect(res.status).toBe(400);
      expect(res.body.error?.message ?? res.body.message).toContain('Cannot create schedule');
    });

    it('[T14] Layer 1: should ACCEPT schedule within working hours (MON 10:00-11:00)', async () => {
      // Arrange: trainer IS available MON 09:00-17:00
      // Act: create a schedule on MON within working hours
      const res = await adminPost('/class-schedule/create').send({
        classId: testClassId,
        trainerId: trainerUserId,
        dayOfWeek: 'MON',
        startTime: '1970-01-01T10:00:00Z',
        endTime: '1970-01-01T11:00:00Z',
        capacity: 20,
        location: 'Studio A',
      });

      // Assert: Layer 1 passes, Layer 2 passes (no conflicts), schedule created
      expect([200, 201]).toContain(res.status);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.trainerId).toBe(trainerUserId);
    });

    it('[T15] Layer 2: should REJECT double-booking (same trainer, overlapping time)', async () => {
      // Arrange: T13 already created MON 10:00-11:00 for this trainer
      // Act: try to book the same trainer MON 10:30-11:30 (overlaps!)
      const res = await adminPost('/class-schedule/create').send({
        classId: testClassId,
        trainerId: trainerUserId,
        dayOfWeek: 'MON',
        startTime: '1970-01-01T10:30:00Z',
        endTime: '1970-01-01T11:30:00Z',
        capacity: 15,
        location: 'Studio B',
      });

      // Assert: Layer 1 passes (MON 09-17), but Layer 2 rejects (overlaps MON 10-11)
      expect(res.status).toBe(400);
    });

    it('[T16] Both Layers: should ACCEPT non-overlapping schedule on same day', async () => {
      // Arrange: trainer has MON 10:00-11:00 booked
      // Act: create MON 14:00-15:00 (within working hours, no overlap)
      const res = await adminPost('/class-schedule/create').send({
        classId: testClassId,
        trainerId: trainerUserId,
        dayOfWeek: 'MON',
        startTime: '1970-01-01T14:00:00Z',
        endTime: '1970-01-01T15:00:00Z',
        capacity: 20,
        location: 'Studio C',
      });

      // Assert: Both layers pass
      expect([200, 201]).toContain(res.status);
      expect(res.body.data).toBeDefined();
    });
  });

  // ─── Scope 4: Trainer Delete ───────────────────────────────────────

  describe('Trainer Delete', () => {
    it('[T17] should delete trainer and cascade availability', async () => {
      // Verify availability exists before delete
      const beforeAvail = await prisma.trainerAvailability.count({
        where: { trainerId: trainerUserId },
      });
      expect(beforeAvail).toBeGreaterThan(0);

      const res = await adminDelete(`/trainer/${trainerUserId}`);
      expect(res.status).toBe(200);

      // Verify availability was cascaded
      const afterAvail = await prisma.trainerAvailability.count({
        where: { trainerId: trainerUserId },
      });
      expect(afterAvail).toBe(0);
    });
  });
});
