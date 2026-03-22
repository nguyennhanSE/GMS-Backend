import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';

describe('User Module Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let trainerToken: string;
  const storageServiceMock = {
    uploadUserAvatar: jest.fn(),
    deleteObject: jest.fn(),
  };

  const ADMIN_EMAIL = 'user-admin@e2e.local';
  const ADMIN_PASSWORD = 'AdminPass@12345';
  const TRAINER_EMAIL = 'user-trainer@e2e.local';
  const TRAINER_PASSWORD = 'TrainerPass@12345';
  const MEMBER_EMAIL = 'user-member@e2e.local';
  const MEMBER_PASSWORD = 'MemberPass@12345';

  let adminUserId: string;
  let trainerUserId: string;
  let createdMemberUserId: string;
  let trainerRoleId: string;

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

    await cleanupTestUsers();

    const [adminRole, trainerRole] = await Promise.all([
      ensureRole('ADMIN', 'Admin role'),
      ensureRole('TRAINER', 'Trainer role'),
    ]);
    await ensureRole('MEMBER', 'Member role');
    await ensureRole('STAFF', 'Staff role');

    trainerRoleId = trainerRole.id;

    const hashedAdminPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const hashedTrainerPassword = await bcrypt.hash(TRAINER_PASSWORD, 10);

    const adminUser = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'Admin',
        email: ADMIN_EMAIL,
        password: hashedAdminPassword,
        status: 'active',
        phone: '0900000001',
        userRole: {
          create: { roleId: adminRole.id },
        },
      },
    });
    adminUserId = adminUser.id;

    const trainerUser = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'Trainer',
        email: TRAINER_EMAIL,
        password: hashedTrainerPassword,
        status: 'active',
        phone: '0900000002',
        userRole: {
          create: { roleId: trainerRole.id },
        },
      },
    });
    trainerUserId = trainerUser.id;

    adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    trainerToken = await login(TRAINER_EMAIL, TRAINER_PASSWORD);
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      await cleanupTestUsers();
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function ensureRole(name: string, description: string) {
    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) {
      return existing;
    }

    return prisma.role.create({
      data: { name, description },
    });
  }

  async function cleanupTestUsers() {
    const emails = [ADMIN_EMAIL, TRAINER_EMAIL, MEMBER_EMAIL];

    await prisma.session.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.userRole.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: emails } },
    });
  }

  async function login(username: string, password: string): Promise<string> {
    const response = await supertest
      .default(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(201);

    const accessToken = response.body?.data?.accessToken as string | undefined;
    if (!accessToken) {
      throw new Error(`Failed to login as ${username}`);
    }

    return accessToken;
  }

  function authGet(token: string, path: string) {
    return supertest
      .default(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  }

  function authPost(token: string, path: string) {
    return supertest
      .default(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
  }

  function authPatch(token: string, path: string) {
    return supertest
      .default(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`);
  }

  function getMessage(body: any): string {
    if (body?.error?.message) {
      return Array.isArray(body.error.message)
        ? body.error.message.join(' ')
        : String(body.error.message);
    }

    if (body?.message) {
      return Array.isArray(body.message)
        ? body.message.join(' ')
        : String(body.message);
    }

    return '';
  }

  describe('create user', () => {
    it('rejects create requests without a password', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'No',
        lastName: 'Password',
        email: MEMBER_EMAIL,
        status: 'active',
      });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain('password');
    });

    it('rejects legacy role names', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'Legacy',
        lastName: 'Role',
        email: MEMBER_EMAIL,
        password: MEMBER_PASSWORD,
        status: 'active',
        role: 'MANAGER',
      });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain(
        'Role must be one of: ADMIN, STAFF, TRAINER, MEMBER',
      );
    });

    it('creates a user with MEMBER role when role is omitted', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'E2E',
        lastName: 'Member',
        email: MEMBER_EMAIL,
        password: MEMBER_PASSWORD,
        status: 'active',
        phone: '0900000003',
      });

      expect([200, 201]).toContain(response.status);
      expect(response.body.data.email).toBe(MEMBER_EMAIL);
      expect(response.body.data.password).toBeUndefined();

      createdMemberUserId = response.body.data.id;

      const roles = await prisma.userRole.findMany({
        where: { userId: createdMemberUserId },
        include: { role: true },
      });

      expect(roles.map((item) => item.role.name)).toEqual(['MEMBER']);
    });

    it('rejects duplicate email addresses', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'Duplicate',
        lastName: 'Member',
        email: MEMBER_EMAIL,
        password: 'AnotherPass@123',
        status: 'active',
      });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain(
        'User with this email already exists',
      );
    });
  });

  describe('getUserRoles authorization', () => {
    it('allows admin to view another user roles', async () => {
      const response = await authGet(
        adminToken,
        `/user/${trainerUserId}/roles`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.userId).toBe(trainerUserId);
      expect(response.body.data.roles).toEqual([{ name: 'TRAINER' }]);
    });

    it('allows a non-admin user to view their own roles', async () => {
      const response = await authGet(
        trainerToken,
        `/user/${trainerUserId}/roles`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.userId).toBe(trainerUserId);
      expect(response.body.data.roles).toEqual([{ name: 'TRAINER' }]);
    });

    it('rejects a non-admin user viewing another user roles', async () => {
      const response = await authGet(
        trainerToken,
        `/user/${adminUserId}/roles`,
      );

      expect(response.status).toBe(403);
      expect(getMessage(response.body)).toContain(
        'Cannot view other users roles',
      );
    });
  });

  describe('role response mapping', () => {
    it('returns composed name and phoneNumber when listing users by role', async () => {
      const response = await authGet(
        adminToken,
        `/user/by-role/${trainerRoleId}`,
      );

      expect(response.status).toBe(200);

      const trainer = response.body.data.users.find(
        (user: { email: string }) => user.email === TRAINER_EMAIL,
      );

      expect(trainer).toBeDefined();
      expect(trainer.name).toBe('E2E Trainer');
      expect(trainer.phoneNumber).toBe('0900000002');
    });

    it('returns composed names for users in role detail responses', async () => {
      const response = await authGet(adminToken, `/roles/${trainerRoleId}`);

      expect(response.status).toBe(200);

      const trainer = response.body.data.users.find(
        (user: { email: string }) => user.email === TRAINER_EMAIL,
      );

      expect(trainer).toBeDefined();
      expect(trainer.name).toBe('E2E Trainer');
    });
  });

  describe('ban flow', () => {
    it('invalidates user sessions when status changes away from active', async () => {
      await login(MEMBER_EMAIL, MEMBER_PASSWORD);

      const sessionsBefore = await prisma.session.count({
        where: { userId: createdMemberUserId },
      });
      expect(sessionsBefore).toBeGreaterThan(0);

      const updateResponse = await authPatch(
        adminToken,
        `/user/${createdMemberUserId}`,
      ).send({
        status: 'inactive',
      });

      expect(updateResponse.status).toBe(200);

      const sessionsAfter = await prisma.session.count({
        where: { userId: createdMemberUserId },
      });
      expect(sessionsAfter).toBe(0);

      const loginResponse = await supertest
        .default(app.getHttpServer())
        .post('/auth/login')
        .send({ username: MEMBER_EMAIL, password: MEMBER_PASSWORD });

      expect(loginResponse.status).toBe(401);
    });
  });

  describe('avatar upload', () => {
    it('allows an authenticated user to upload an avatar for themselves', async () => {
      const avatarUrl =
        'https://res.cloudinary.com/demo/image/upload/v1/users/e2e/avatar/avatar-1.png';
      storageServiceMock.uploadUserAvatar.mockResolvedValue({
        url: avatarUrl,
        key: 'users/e2e/avatar/avatar-1',
        contentType: 'image/png',
      });

      const response = await authPatch(trainerToken, '/user/avatar').attach(
        'file',
        Buffer.from('fake-image'),
        {
          filename: 'avatar.png',
          contentType: 'image/png',
        },
      );

      expect(response.status).toBe(200);
      expect(response.body.data.avatarUrl).toBe(avatarUrl);

      const persisted = await prisma.user.findUnique({
        where: { id: trainerUserId },
      });
      expect(persisted?.avatarUrl).toBe(avatarUrl);
    });

    it('rejects invalid avatar mime types', async () => {
      storageServiceMock.uploadUserAvatar.mockResolvedValue({
        url: 'https://res.cloudinary.com/demo/image/upload/v1/users/e2e/avatar/avatar-2.png',
        key: 'users/e2e/avatar/avatar-2',
        contentType: 'image/png',
      });

      const response = await authPatch(trainerToken, '/user/avatar').attach(
        'file',
        Buffer.from('not-an-image'),
        {
          filename: 'avatar.txt',
          contentType: 'text/plain',
        },
      );

      expect(response.status).toBe(400);
      expect(storageServiceMock.uploadUserAvatar).not.toHaveBeenCalled();
    });

    it('rejects requests without a file', async () => {
      const response = await authPatch(trainerToken, '/user/avatar');

      expect(response.status).toBe(400);
      expect(storageServiceMock.uploadUserAvatar).not.toHaveBeenCalled();
    });
  });
});
