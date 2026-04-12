import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { NodemailerService } from '../src/libs/integration/nodemailer/nodemailer.service';

describe('User Module Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let trainerToken: string;
  const storageServiceMock = {
    uploadUserAvatar: jest.fn(),
    deleteObject: jest.fn(),
  };
  const mockNodemailerService = {
    sendEmail: jest.fn().mockResolvedValue(true),
  };

  const ADMIN_EMAIL = 'user-admin@e2e.local';
  const ADMIN_PASSWORD = 'AdminPass@12345';
  const TRAINER_EMAIL = 'user-trainer@e2e.local';
  const TRAINER_PASSWORD = 'TrainerPass@12345';
  const MEMBER_EMAIL = 'user-member@e2e.local';
  const MEMBER_PASSWORD = 'MemberPass@12345';
  const REGISTER_EMAIL = 'user-register@e2e.local';
  const REGISTER_PASSWORD = 'RegisterPass@12345';
  const ROLLBACK_EMAIL = 'user-rollback@e2e.local';

  let adminUserId: string;
  let trainerUserId: string;
  let createdMemberUserId: string;
  let memberVerificationToken: string;
  let registeredMemberUserId: string;
  let registeredMemberVerificationToken: string;
  let trainerRoleId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(storageServiceMock)
      .overrideProvider(NodemailerService)
      .useValue(mockNodemailerService)
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
    mockNodemailerService.sendEmail.mockResolvedValue(true);
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
    const emails = [
      ADMIN_EMAIL,
      TRAINER_EMAIL,
      MEMBER_EMAIL,
      REGISTER_EMAIL,
      ROLLBACK_EMAIL,
    ];

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

  function extractVerificationTokenFromEmail(): string {
    const [firstCall] = mockNodemailerService.sendEmail.mock.calls;
    if (!firstCall?.[0]) {
      throw new Error('Verification email was not sent');
    }

    const payload = firstCall[0] as { html?: string; text?: string };
    const content = `${payload.html ?? ''}\n${payload.text ?? ''}`;
    const match = content.match(/\/user\/verify-email\?token=([^"'&<\s]+)/);

    if (!match?.[1]) {
      throw new Error('Verification token not found in email payload');
    }

    return decodeURIComponent(match[1]);
  }

  describe('create user', () => {
    it('rejects create requests that try to set password directly', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'Password',
        lastName: 'Override',
        email: MEMBER_EMAIL,
        password: MEMBER_PASSWORD,
      });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain('password should not exist');
    });

    it('rejects legacy role names', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'Legacy',
        lastName: 'Role',
        email: MEMBER_EMAIL,
        role: 'MANAGER',
      });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain(
        'Role must be one of: ADMIN, STAFF, TRAINER, MEMBER',
      );
    });

    it('rejects create requests that try to set status', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'Status',
        lastName: 'Override',
        email: 'status-override@e2e.local',
        status: 'active',
      });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain('status should not exist');
    });

    it('rolls back the user if verification email sending fails', async () => {
      mockNodemailerService.sendEmail.mockResolvedValueOnce(false);

      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'Rollback',
        lastName: 'Case',
        email: ROLLBACK_EMAIL,
        phone: '0900000004',
      });

      expect(response.status).toBe(500);
      expect(getMessage(response.body)).toContain(
        'Failed to send verification email',
      );

      const persisted = await prisma.user.findUnique({
        where: { email: ROLLBACK_EMAIL },
      });
      expect(persisted).toBeNull();
    });

    it('creates a user with MEMBER role when role is omitted', async () => {
      const response = await authPost(adminToken, '/user/create').send({
        firstName: 'E2E',
        lastName: 'Member',
        email: MEMBER_EMAIL,
        phone: '0900000003',
      });

      expect([200, 201]).toContain(response.status);
      expect(response.body.data.email).toBe(MEMBER_EMAIL);
      expect(response.body.data.password).toBeUndefined();
      expect(response.body.data.status).toBe('pending_verification');
      expect(mockNodemailerService.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockNodemailerService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: MEMBER_EMAIL,
          subject: 'Verify Your Liflow Account',
        }),
      );

      createdMemberUserId = response.body.data.id;
      memberVerificationToken = extractVerificationTokenFromEmail();

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
      });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain(
        'User with this email already exists',
      );
    });
  });

  describe('public member registration', () => {
    it('rejects register requests that try to set role or status', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/register')
        .send({
          firstName: 'Public',
          lastName: 'Register',
          email: REGISTER_EMAIL,
          password: REGISTER_PASSWORD,
          confirmPassword: REGISTER_PASSWORD,
          role: 'ADMIN',
          status: 'active',
        });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain('should not exist');
    });

    it('rejects register requests with mismatched passwords', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/register')
        .send({
          firstName: 'Mismatch',
          lastName: 'Register',
          email: 'register-mismatch@e2e.local',
          password: REGISTER_PASSWORD,
          confirmPassword: 'DifferentPass@12345',
        });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain(
        'Password confirmation does not match',
      );
    });

    it('creates a pending MEMBER account through /auth/register', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/register')
        .send({
          firstName: 'Public',
          lastName: 'Member',
          email: REGISTER_EMAIL,
          password: REGISTER_PASSWORD,
          confirmPassword: REGISTER_PASSWORD,
          phone: '0900000005',
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body.data.email).toBe(REGISTER_EMAIL);
      expect(response.body.data.status).toBe('pending_verification');
      expect(mockNodemailerService.sendEmail).toHaveBeenCalledTimes(1);

      registeredMemberUserId = response.body.data.id;
      registeredMemberVerificationToken = extractVerificationTokenFromEmail();

      const roles = await prisma.userRole.findMany({
        where: { userId: registeredMemberUserId },
        include: { role: true },
      });

      expect(roles.map((item) => item.role.name)).toEqual(['MEMBER']);
    });

    it('rejects duplicate emails through /auth/register', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/register')
        .send({
          firstName: 'Duplicate',
          lastName: 'Register',
          email: REGISTER_EMAIL,
          password: REGISTER_PASSWORD,
          confirmPassword: REGISTER_PASSWORD,
        });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain(
        'User with this email already exists',
      );
    });

    it('blocks login for a self-registered member before verification', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/login')
        .send({ username: REGISTER_EMAIL, password: REGISTER_PASSWORD });

      expect(response.status).toBe(401);
      expect(getMessage(response.body)).toContain(
        'Account is inactive or banned',
      );
    });

    it('activates a self-registered member after email verification', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/user/verify-email')
        .send({
          token: registeredMemberVerificationToken,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(registeredMemberUserId);
      expect(response.body.data.status).toBe('active');
    });

    it('renders a verification page without password fields for self-registration', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get('/user/verify-email')
        .query({ token: registeredMemberVerificationToken });

      expect(response.status).toBe(200);
      expect(response.text).toContain('Activate Account');
      expect(response.text).not.toContain('name="password"');
      expect(response.text).not.toContain('name="confirmPassword"');
    });

    it('allows login after public member registration verification', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/login')
        .send({ username: REGISTER_EMAIL, password: REGISTER_PASSWORD });

      expect(response.status).toBe(201);
      expect(response.body.data.user.email).toBe(REGISTER_EMAIL);
      expect(response.body.data.accessToken).toBeDefined();
    });
  });

  describe('email verification flow', () => {
    it('returns a landing page on GET without activating the account', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get('/user/verify-email')
        .query({ token: memberVerificationToken });

      expect(response.status).toBe(200);
      expect(response.text).toContain('Set Password and Activate Account');
      expect(response.text).toContain('name="password"');
      expect(response.text).toContain('name="confirmPassword"');

      const persisted = await prisma.user.findUnique({
        where: { id: createdMemberUserId },
      });
      expect(persisted?.status).toBe('pending_verification');
    });

    it('rejects invalid tokens on the verification landing page', async () => {
      const maliciousToken = '"><script>alert("xss")</script>';
      const response = await supertest
        .default(app.getHttpServer())
        .get('/user/verify-email')
        .query({ token: maliciousToken });

      expect(response.status).toBe(401);
    });

    it('blocks login before email verification', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/login')
        .send({ username: MEMBER_EMAIL, password: MEMBER_PASSWORD });

      expect(response.status).toBe(401);
      expect(getMessage(response.body)).toContain(
        'Account is inactive or banned',
      );
    });

    it('requires a password during verification', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/user/verify-email')
        .send({ token: memberVerificationToken });

      expect(response.status).toBe(400);
      expect(getMessage(response.body)).toContain(
        'Password and confirmPassword are required',
      );
    });

    it('activates the user when the verification link is completed', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/user/verify-email')
        .send({
          token: memberVerificationToken,
          password: MEMBER_PASSWORD,
          confirmPassword: MEMBER_PASSWORD,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(createdMemberUserId);
      expect(response.body.data.status).toBe('active');

      const persisted = await prisma.user.findUnique({
        where: { id: createdMemberUserId },
      });
      expect(persisted?.status).toBe('active');
    });

    it('allows login after email verification', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/auth/login')
        .send({ username: MEMBER_EMAIL, password: MEMBER_PASSWORD });

      expect(response.status).toBe(201);
      expect(response.body.data.user.email).toBe(MEMBER_EMAIL);
      expect(response.body.data.accessToken).toBeDefined();
    });

    it('rejects invalid verification tokens', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/user/verify-email')
        .send({
          token: 'not-a-valid-token',
        });

      expect(response.status).toBe(401);
      expect(getMessage(response.body)).toContain(
        'Verification token is invalid or expired',
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
