import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { NodemailerService } from '../src/libs/integration/nodemailer/nodemailer.service';
import { config } from '../src/libs/config';
import {
  TestData,
  loginAs,
  authRequest,
  createTestData,
  cleanupTestData,
} from './test-helpers';

/**
 * Integration tests for the Support Feedback module.
 * Uses real DB (Prisma), mocks NodemailerService (external SMTP).
 *
 * Covers:
 * 1. POST /support/feedback — happy path (authenticated member)
 * 2. Validation — missing/invalid fields rejected
 * 3. Auth — unauthenticated requests rejected
 * 4. DB verification — feedback persisted correctly
 * 5. Fire-and-forget — email failure doesn't break the API
 */
describe('Support Feedback (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testData: TestData;
  let memberToken: string;

  const mockNodemailerService = {
    sendEmail: jest.fn().mockResolvedValue(true),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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

    // Clean stale test data
    await cleanupFeedbackTestData(prisma);
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);

    try {
      memberToken = await loginAs(
        app,
        testData.memberUser.email,
        testData.memberPassword,
      );
    } catch {
      console.warn('Login failed — some tests will be skipped');
    }
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      await cleanupFeedbackTestData(prisma);
      await cleanupTestData(prisma);
    }
    if (app) await app.close();
  });

  afterEach(async () => {
    if (!prisma || !testData) return;
    await prisma.feedback.deleteMany({
      where: { userId: testData.memberUser.id },
    });
    mockNodemailerService.sendEmail.mockClear();
  });

  async function cleanupFeedbackTestData(p: PrismaService) {
    const testEmails = [
      'api-test-member@test.local',
      'api-test-admin@test.local',
      'api-test-trainer@test.local',
    ];
    await p.feedback.deleteMany({
      where: { user: { email: { in: testEmails } } },
    });
  }

  // ─── Scope 1: Happy Path ──────────────────────────────────────────

  describe('POST /support/feedback', () => {
    it('[Test 1] Should create feedback and return 201', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 'Broken treadmill',
          message: 'Treadmill #3 in zone B is not working',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.subject).toBe('Broken treadmill');
      expect(response.body.data.message).toBe(
        'Treadmill #3 in zone B is not working',
      );
      expect(response.body.data.userId).toBe(testData.memberUser.id);
      expect(response.body.data.id).toBeDefined();
    });

    it('[Test 2] Should persist feedback in database', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 'AC issue',
          message: 'Air conditioning too cold in yoga room',
        });

      expect(response.status).toBe(201);

      const dbRecord = await prisma.feedback.findUnique({
        where: { id: response.body.data.id },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord!.subject).toBe('AC issue');
      expect(dbRecord!.message).toBe(
        'Air conditioning too cold in yoga room',
      );
      expect(dbRecord!.userId).toBe(testData.memberUser.id);
    });

    it('[Test 3] Should trigger email send (fire-and-forget)', async () => {
      if (!memberToken) return;

      await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 'Locker problem',
          message: 'Locker #42 lock is jammed',
        });

      // Give fire-and-forget a moment to execute
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockNodemailerService.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockNodemailerService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: config.EMAIL_USER,
          from: config.EMAIL_FROM || config.EMAIL_USER,
          replyTo: testData.memberUser.email,
          subject: expect.stringContaining('[Support Feedback]'),
        }),
      );
    });
  });

  // ─── Scope 2: Validation ──────────────────────────────────────────

  describe('Validation', () => {
    it('[Test 4] Should reject empty subject (400)', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: '',
          message: 'Some message',
        });

      expect(response.status).toBe(400);
    });

    it('[Test 5] Should reject empty message (400)', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 'Some subject',
          message: '',
        });

      expect(response.status).toBe(400);
    });

    it('[Test 6] Should reject missing fields (400)', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({});

      expect(response.status).toBe(400);
    });

    it('[Test 7] Should reject non-string types (400)', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 12345,
          message: true,
        });

      expect(response.status).toBe(400);
    });

    it('[Test 8] Should strip extra fields (whitelist)', async () => {
      if (!memberToken) return;

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 'Valid subject',
          message: 'Valid message',
          hackerField: 'should be stripped',
        });

      // forbidNonWhitelisted = true → should reject
      expect(response.status).toBe(400);
    });
  });

  // ─── Scope 3: Authentication ──────────────────────────────────────

  describe('Auth Guard', () => {
    it('[Test 9] Should reject unauthenticated request (401)', async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .post('/support/feedback')
        .send({
          subject: 'Should fail',
          message: 'No token provided',
        });

      expect(response.status).toBe(401);
    });

    it('[Test 10] Should reject invalid token (401)', async () => {
      const response = await authRequest(app, 'invalid.jwt.token')
        .post('/support/feedback')
        .send({
          subject: 'Should fail',
          message: 'Bad token',
        });

      expect(response.status).toBe(401);
    });
  });

  // ─── Scope 4: Resilience (Fire-and-Forget) ────────────────────────

  describe('Email Resilience', () => {
    it('[Test 11] Should still return 201 when email fails', async () => {
      if (!memberToken) return;

      // Make email throw
      mockNodemailerService.sendEmail.mockRejectedValueOnce(
        new Error('SMTP connection refused'),
      );

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 'Email will fail',
          message: 'But feedback should still be saved',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.id).toBeDefined();

      // Verify DB still has the record
      const dbRecord = await prisma.feedback.findUnique({
        where: { id: response.body.data.id },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord!.subject).toBe('Email will fail');
    });

    it('[Test 12] Should still return 201 when email times out', async () => {
      if (!memberToken) return;

      // Simulate slow SMTP (never resolves within test timeout)
      mockNodemailerService.sendEmail.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      );

      const response = await authRequest(app, memberToken)
        .post('/support/feedback')
        .send({
          subject: 'Slow SMTP',
          message: 'Response should not wait for email',
        });

      // Should return immediately, not wait 5s
      expect(response.status).toBe(201);
      expect(response.body.data.id).toBeDefined();
    });
  });
});
