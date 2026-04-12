import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../src/modules/user/user.service';
import * as supertest from 'supertest';
import * as bcrypt from 'bcrypt';
import { sha256Hash } from '../src/utils/hash';
import { AuthRepository } from '../src/modules/auth/repositories/auth.repository';

/**
 * Auth Integration Tests (e2e)
 * Uses real DB (Prisma), real JWT, real EventEmitter.
 * No mocks — tests the full auth flow end-to-end.
 *
 * Covers:
 * 1. Login (active, banned, invalid creds)
 * 2. SHA-256 token hashing (tokens stored as hashes, not plaintext)
 * 3. Refresh token rotation (happy path, banned user, replay detection)
 * 4. rememberMe (token expiry difference)
 * 5. Zombie session defense (user.banned event wipes sessions)
 * 6. Logout
 *
 * NOTE: Refresh token tests depend on the JWT `username` field
 * containing the user.id (UUID), NOT the email. Login currently
 * stores the email as `username` in the JWT payload, causing
 * refreshToken() → getUserByAccount(email) → Prisma UUID error.
 * Tests that hit this pre-existing bug are documented below.
 */
describe('Auth Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userService: UserService;

  const TEST_PASSWORD = 'TestAuth@12345';
  const TEST_EMAIL = 'auth-integ-test@test.local';
  const TEST_EMAIL_BANNED = 'auth-integ-banned@test.local';

  let testUserId: string;
  let bannedUserId: string;

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
    userService = app.get(UserService);

    // Cleanup stale test data
    await cleanupAuthTestData(prisma);

    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);

    // Ensure MEMBER role exists
    let memberRole = await prisma.role.findFirst({ where: { name: 'MEMBER' } });
    if (!memberRole) {
      memberRole = await prisma.role.create({
        data: { name: 'MEMBER', description: 'Member role' },
      });
    }

    // Create active test user
    const activeUser = await prisma.user.create({
      data: {
        firstName: 'Auth',
        lastName: 'TestActive',
        email: TEST_EMAIL,
        password: hashedPassword,
        status: 'active',
        userRole: { create: { roleId: memberRole.id } },
      },
    });
    testUserId = activeUser.id;

    // Create banned test user
    const bannedUser = await prisma.user.create({
      data: {
        firstName: 'Auth',
        lastName: 'TestBanned',
        email: TEST_EMAIL_BANNED,
        password: hashedPassword,
        status: 'inactive',
        userRole: { create: { roleId: memberRole.id } },
      },
    });
    bannedUserId = bannedUser.id;
  }, 60000);

  afterAll(async () => {
    if (prisma) await cleanupAuthTestData(prisma);
    if (app) await app.close();
  });

  afterEach(async () => {
    if (!prisma) return;
    // Clean up sessions + refreshTokenUsed between tests
    await prisma.refreshTokenUsed.deleteMany({
      where: { session: { userId: { in: [testUserId, bannedUserId] } } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [testUserId, bannedUserId] } },
    });
    // Restore active status after tests that ban users
    await prisma.user.updateMany({
      where: { id: testUserId },
      data: { status: 'active' },
    });
    await prisma.user.updateMany({
      where: { id: bannedUserId },
      data: { status: 'inactive' },
    });
  });

  async function cleanupAuthTestData(p: PrismaService) {
    const emails = [TEST_EMAIL, TEST_EMAIL_BANNED];
    await p.refreshTokenUsed.deleteMany({
      where: { session: { user: { email: { in: emails } } } },
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

  /** Helper: POST /auth/login */
  function postLogin(body: Record<string, unknown>) {
    return supertest.default(app.getHttpServer()).post('/auth/login').send(body);
  }

  /** Helper: POST /auth/refresh-token */
  function postRefresh(body: Record<string, unknown>) {
    return supertest.default(app.getHttpServer()).post('/auth/refresh-token').send(body);
  }

  /** Helper: POST /auth/logout */
  function postLogout(body: Record<string, unknown>) {
    return supertest.default(app.getHttpServer()).post('/auth/logout').send(body);
  }

  // ─── Scope 1: Login ────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('[Test 1] should login active user and return tokens', async () => {
      const res = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
    });

    it('[Test 2] should reject banned/inactive user with 401', async () => {
      const res = await postLogin({
        username: TEST_EMAIL_BANNED,
        password: TEST_PASSWORD,
      });

      expect(res.status).toBe(401);
    });

    it('[Test 3] should reject wrong password with 401', async () => {
      const res = await postLogin({
        username: TEST_EMAIL,
        password: 'WrongPassword123!',
      });

      expect(res.status).toBe(401);
    });

    it('[Test 4] should reject non-existent user with 400', async () => {
      const res = await postLogin({
        username: 'nobody@test.local',
        password: TEST_PASSWORD,
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Scope 2: SHA-256 Token Hashing ────────────────────────────────

  describe('SHA-256 Token Hashing', () => {
    it('[Test 5] stored refresh token should be SHA-256 hash, not plaintext', async () => {
      const res = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(201);

      const rawRefreshToken = res.body.data.refreshToken;
      const expectedHash = sha256Hash(rawRefreshToken);

      // Check DB directly — token should be hashed
      const session = await prisma.session.findFirst({
        where: { userId: testUserId },
      });

      expect(session).not.toBeNull();
      expect(session!.refreshToken).not.toBe(rawRefreshToken); // NOT plaintext
      expect(session!.refreshToken).toBe(expectedHash); // IS sha256 hash
    });

    it('[Test 6] markRefreshTokenUsed should store hash, not plaintext', async () => {
      const res = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(201);
      const rawRefreshToken = res.body.data.refreshToken;

      // Find the session
      const session = await prisma.session.findFirst({
        where: { userId: testUserId },
      });
      expect(session).not.toBeNull();

      // Manually mark the token as used via repository
      const authRepo = app.get(AuthRepository);
      await authRepo.markRefreshTokenUsed(rawRefreshToken, session!.id);

      // Check that it's stored as hash
      const usedRecord = await prisma.refreshTokenUsed.findFirst({
        where: { sessionId: session!.id },
      });
      expect(usedRecord).not.toBeNull();
      expect(usedRecord!.refreshToken).not.toBe(rawRefreshToken);
      expect(usedRecord!.refreshToken).toBe(sha256Hash(rawRefreshToken));
    });
  });


  // ─── Scope 3: Refresh Token Rotation ───────────────────────────────


  describe('POST /auth/refresh-token', () => {
    it('[Test 7] should reject invalid/garbage refresh token', async () => {
      const res = await postRefresh({ refreshToken: 'garbage.token.value' });
      expect(res.status).toBe(401);
    });

    it('[Test 8] should issue new tokens on valid refresh', async () => {
      // Login first
      const loginRes = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      expect(loginRes.status).toBe(201);
      const refreshToken = loginRes.body.data.refreshToken;

      // Refresh
      const res = await postRefresh({ refreshToken });
      expect(res.status).toBe(201);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.newRefreshToken).toBeDefined();

      // Verify old token was marked as used (proof of rotation)
      const usedRecord = await prisma.refreshTokenUsed.findFirst({
        where: { refreshToken: sha256Hash(refreshToken) },
      });
      expect(usedRecord).not.toBeNull();
    });

    it('[Test 8b] should detect replay attack (reused refresh token)', async () => {
      const loginRes = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      const originalRefreshToken = loginRes.body.data.refreshToken;

      // Use refresh token once (legitimate)
      const refreshRes = await postRefresh({ refreshToken: originalRefreshToken });
      expect(refreshRes.status).toBe(201);

      // Replay attack: try to use the OLD refresh token again
      const replayRes = await postRefresh({ refreshToken: originalRefreshToken });
      expect(replayRes.status).toBe(401);

      // All sessions should be wiped (security measure)
      const remainingSessions = await prisma.session.count({
        where: { userId: testUserId },
      });
      expect(remainingSessions).toBe(0);
    });

    it('[Test 8c] should reject refresh for banned user and wipe sessions', async () => {
      // Temporarily activate banned user so they can login
      await prisma.user.update({
        where: { id: bannedUserId },
        data: { status: 'active' },
      });

      const loginRes = await postLogin({
        username: TEST_EMAIL_BANNED,
        password: TEST_PASSWORD,
      });
      expect(loginRes.status).toBe(201);
      const refreshToken = loginRes.body.data.refreshToken;

      // Ban the user
      await prisma.user.update({
        where: { id: bannedUserId },
        data: { status: 'inactive' },
      });

      // Attempt to refresh — should fail with 401
      const res = await postRefresh({ refreshToken });
      expect(res.status).toBe(401);

      // Verify all sessions wiped from DB
      const remainingSessions = await prisma.session.count({
        where: { userId: bannedUserId },
      });
      expect(remainingSessions).toBe(0);
    });
  });

  // ─── Scope 4: rememberMe ──────────────────────────────────────────

  describe('rememberMe token expiry', () => {
    /** Decode JWT payload without verification to read exp */
    function decodeJwtPayload(token: string) {
      const base64 = token.split('.')[1];
      return JSON.parse(Buffer.from(base64, 'base64url').toString('utf-8'));
    }

    it('[Test 9] rememberMe=true should have LONGER expiry than rememberMe=false', async () => {
      // Login with rememberMe=false
      const resFalse = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
        rememberMe: false,
      });
      expect(resFalse.status).toBe(201);
      const payloadFalse = decodeJwtPayload(resFalse.body.data.refreshToken);
      const lifetimeFalse = payloadFalse.exp - payloadFalse.iat;

      // Login with rememberMe=true
      const resTrue = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
        rememberMe: true,
      });
      expect(resTrue.status).toBe(201);
      const payloadTrue = decodeJwtPayload(resTrue.body.data.refreshToken);
      const lifetimeTrue = payloadTrue.exp - payloadTrue.iat;

      // rememberMe=true MUST give a longer expiry
      expect(lifetimeTrue).toBeGreaterThan(lifetimeFalse);

      // rememberMe=true should be ~30 days (2592000s ± tolerance)
      expect(lifetimeTrue).toBeGreaterThanOrEqual(2592000 - 10);
      expect(lifetimeTrue).toBeLessThanOrEqual(2592000 + 10);
    });
  });

  // ─── Scope 5: Zombie Session Defense (EventEmitter) ────────────────

  describe('Zombie session defense', () => {
    it('[Test 10] banning user via UserService.update() should wipe sessions', async () => {
      // Login to get an active session
      const loginRes = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      expect(loginRes.status).toBe(201);

      // Verify session exists in DB
      const sessionsBefore = await prisma.session.count({
        where: { userId: testUserId },
      });
      expect(sessionsBefore).toBeGreaterThan(0);

      // Ban via UserService.update() — should emit user.banned event
      await userService.update(testUserId, { status: 'inactive' } as any);

      // Brief wait for async event propagation
      await new Promise(resolve => setTimeout(resolve, 200));

      // All sessions should be wiped
      const sessionsAfter = await prisma.session.count({
        where: { userId: testUserId },
      });
      expect(sessionsAfter).toBe(0);
    });

    it('[Test 11] banned user should not be able to login', async () => {
      // Ban the user first
      await prisma.user.update({
        where: { id: testUserId },
        data: { status: 'inactive' },
      });

      // Attempt login
      const res = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── Scope 6: Logout ──────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('[Test 12] should invalidate refresh token on logout', async () => {
      // Login
      const loginRes = await postLogin({
        username: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      expect(loginRes.status).toBe(201);
      const refreshToken = loginRes.body.data.refreshToken;

      // Logout
      const logoutRes = await postLogout({ refreshToken });
      expect(logoutRes.status).toBe(201);

      // Session should be removed from DB
      const session = await prisma.session.findFirst({
        where: { refreshToken: sha256Hash(refreshToken) },
      });
      expect(session).toBeNull();
    });

    it('[Test 13] should handle logout with missing/invalid token gracefully', async () => {
      const res = await postLogout({ refreshToken: 'nonexistent.token.value' });
      // Should not crash — may return error but not 500
      expect(res.status).toBeLessThan(500);
    });
  });
});
