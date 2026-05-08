import { expect, test, type APIRequestContext } from '@playwright/test';
import net from 'net';
import { PrismaService } from '../../prisma/prisma.service';
import {
  cleanupApiTestData,
  createApiContext,
  disconnectDatabase,
  loginAs,
  seedApiUsers,
  startTemporaryApiServer,
  type SeededUsers,
  type TemporaryApiServer,
} from './api-helpers';
import {
  ResendTestServer,
  type ResendTestServerOptions,
} from './resend-test-server';
import { isDeployedTarget } from './target-mode';

const prisma = new PrismaService();
const SUPPORT_ADMIN_EMAIL = 'support-admin@test.local';
const SUPPORT_FROM_EMAIL = 'GMS <support-bot@test.local>';

type SupportHarness = {
  server: TemporaryApiServer;
  anonymousApi: APIRequestContext;
  memberApi: APIRequestContext;
  adminApi: APIRequestContext;
  resendServer?: ResendTestServer;
  stop: () => Promise<void>;
};

test.describe('Support Playwright API E2E', () => {
  test.skip(
    isDeployedTarget(),
    'Support Playwright tests require a temporary local Resend-compatible server and per-process email env overrides.',
  );

  let seededUsers: SeededUsers;
  let defaultHarness: SupportHarness;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await prisma.$connect();
    seededUsers = await seedApiUsers();
    defaultHarness = await startSupportHarness();
  });

  test.afterEach(async () => {
    await cleanupFeedbacks();
    defaultHarness.resendServer?.clearMessages();
  });

  test.afterAll(async () => {
    await defaultHarness?.stop();
    await cleanupApiTestData();
    await prisma.$disconnect();
    await disconnectDatabase();
  });

  test('submits member feedback, persists it, and delivers a support email with reply-to', async () => {
    const subject = 'Broken treadmill';
    const message = 'Treadmill #3 in zone B is not working. Please inspect today.';
    const response = await defaultHarness.memberApi.post('support/feedback', {
      data: {
        subject,
        message,
      },
    });

    expect(response.status()).toBe(201);

    const body = (await response.json()) as {
      data: {
        id: string;
        userId: string;
        subject: string;
        message: string;
      };
    };

    expect(body.data.userId).toBe(seededUsers.member.id);
    expect(body.data.subject).toBe(subject);
    expect(body.data.message).toBe(message);

    const savedFeedback = await prisma.feedback.findUnique({
      where: { id: body.data.id },
    });

    expect(savedFeedback).not.toBeNull();
    expect(savedFeedback?.userId).toBe(seededUsers.member.id);
    expect(savedFeedback?.subject).toBe(subject);
    expect(savedFeedback?.message).toBe(message);

    const deliveredEmail = await defaultHarness.resendServer?.waitForMessage();
    expect(deliveredEmail).toBeDefined();
    expect(deliveredEmail?.headers.authorization).toBe('Bearer re_test_key');
    expect(deliveredEmail?.body).toEqual(
      expect.objectContaining({
        to: SUPPORT_ADMIN_EMAIL,
        from: SUPPORT_FROM_EMAIL,
        reply_to: seededUsers.member.email,
        subject: `[Support Feedback] ${subject}`,
      }),
    );
    expect(String(deliveredEmail?.body.html)).toContain('New Support Feedback');
    expect(String(deliveredEmail?.body.html)).toContain(
      seededUsers.member.email,
    );
    expect(String(deliveredEmail?.body.html)).toContain(message);
  });

  test('allows admins to submit feedback and routes reply-to to the authenticated admin', async () => {
    const response = await defaultHarness.adminApi.post('support/feedback', {
      data: {
        subject: 'Front desk note',
        message: 'Reception needs more badge lanyards.',
      },
    });

    expect(response.status()).toBe(201);

    const email = await defaultHarness.resendServer?.waitForMessage();
    expect(email?.body.reply_to).toBe(seededUsers.admin.email);

    const feedbackCount = await prisma.feedback.count({
      where: { userId: seededUsers.admin.id },
    });
    expect(feedbackCount).toBe(1);
  });

  test('persists feedback and skips support email when SUPPORT_EMAIL_TO is blank', async () => {
    const harness = await startSupportHarness({
      envOverrides: {
        SUPPORT_EMAIL_TO: '',
      },
    });

    try {
      const response = await harness.memberApi.post('support/feedback', {
        data: {
          subject: 'Missing support recipient',
          message: 'The feedback should be saved without routing email to EMAIL_FROM.',
        },
      });

      expect(response.status()).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(harness.resendServer?.getMessages()).toHaveLength(0);
    } finally {
      await harness.stop();
    }
  });

  test('rejects unauthenticated feedback requests', async () => {
    const response = await defaultHarness.anonymousApi.post('support/feedback', {
      data: {
        subject: 'Anonymous request',
        message: 'This should not go through.',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('rejects invalid bearer tokens', async () => {
    const invalidApi = await createApiContext('invalid.jwt.token');

    try {
      const response = await invalidApi.post('support/feedback', {
        data: {
          subject: 'Bad token',
          message: 'This should fail authentication.',
        },
      });

      expect(response.status()).toBe(401);
    } finally {
      await invalidApi.dispose();
    }
  });

  test('rejects empty subjects', async () => {
    const response = await defaultHarness.memberApi.post('support/feedback', {
      data: {
        subject: '',
        message: 'Some message',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects empty messages', async () => {
    const response = await defaultHarness.memberApi.post('support/feedback', {
      data: {
        subject: 'Some subject',
        message: '',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects missing required fields', async () => {
    const response = await defaultHarness.memberApi.post('support/feedback', {
      data: {},
    });

    expect(response.status()).toBe(400);
  });

  test('rejects non-string subject and message payloads', async () => {
    const response = await defaultHarness.memberApi.post('support/feedback', {
      data: {
        subject: 12345,
        message: true,
      },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects unexpected extra fields because global validation forbids non-whitelisted input', async () => {
    const response = await defaultHarness.memberApi.post('support/feedback', {
      data: {
        subject: 'Valid subject',
        message: 'Valid message',
        hackerField: 'unexpected',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('persists feedback even when the Resend API is unavailable', async () => {
    const unusedPort = await reserveUnusedPort();
    const harness = await startSupportHarness({
      skipResendServer: true,
      envOverrides: {
        RESEND_API_URL: `http://127.0.0.1:${unusedPort}/emails`,
        RESEND_EMAIL_TIMEOUT_MS: '250',
      },
    });

    try {
      const startedAt = Date.now();
      const response = await harness.memberApi.post('support/feedback', {
        data: {
          subject: 'Resend unavailable',
          message: 'Saving feedback should not depend on the email API being online.',
        },
      });
      const durationMs = Date.now() - startedAt;

      expect(response.status()).toBe(201);
      expect(durationMs).toBeLessThan(1_500);

      const body = (await response.json()) as {
        data: { id: string };
      };
      const savedFeedback = await prisma.feedback.findUnique({
        where: { id: body.data.id },
      });
      expect(savedFeedback).not.toBeNull();
      expect(savedFeedback?.subject).toBe('Resend unavailable');
    } finally {
      await harness.stop();
    }
  });

  test('returns immediately even when the Resend API responds slowly', async () => {
    const harness = await startSupportHarness({
      resendOptions: {
        responseDelayMs: 3_000,
      },
    });

    try {
      const startedAt = Date.now();
      const response = await harness.memberApi.post('support/feedback', {
        data: {
          subject: 'Slow Resend',
          message: 'The HTTP response should not wait for the outbound email to finish.',
        },
      });
      const durationMs = Date.now() - startedAt;

      expect(response.status()).toBe(201);
      expect(durationMs).toBeLessThan(1_500);
      await harness.resendServer?.waitForMessage();
      await new Promise((resolve) => setTimeout(resolve, 3_200));
    } finally {
      await harness.stop();
    }
  });

  async function cleanupFeedbacks() {
    await prisma.feedback.deleteMany({
      where: {
        userId: {
          in: [seededUsers.member.id, seededUsers.admin.id],
        },
      },
    });
  }
});

async function startSupportHarness(options: {
  envOverrides?: Record<string, string>;
  resendOptions?: ResendTestServerOptions;
  skipResendServer?: boolean;
} = {}): Promise<SupportHarness> {
  let resendServer: ResendTestServer | undefined;
  const envOverrides = {
    RESEND_API_KEY: 're_test_key',
    RESEND_API_URL: '',
    RESEND_EMAIL_TIMEOUT_MS: '1000',
    EMAIL_FROM: SUPPORT_FROM_EMAIL,
    SUPPORT_EMAIL_TO: SUPPORT_ADMIN_EMAIL,
    ...options.envOverrides,
  };

  if (!options.skipResendServer) {
    resendServer = new ResendTestServer(options.resendOptions);
    await resendServer.start();
    envOverrides.RESEND_API_URL = resendServer.url;
  }

  const server = await startTemporaryApiServer(envOverrides);
  const anonymousApi = await createApiContext(undefined, server.baseURL);
  const memberApi = await createAuthenticatedContext(
    anonymousApi,
    server.baseURL,
    'playwright-member@test.local',
    'PlaywrightApi@12345',
  );
  const adminApi = await createAuthenticatedContext(
    anonymousApi,
    server.baseURL,
    'playwright-admin@test.local',
    'PlaywrightApi@12345',
  );

  return {
    server,
    anonymousApi,
    memberApi,
    adminApi,
    resendServer,
    stop: async () => {
      await Promise.all([
        anonymousApi.dispose(),
        memberApi.dispose(),
        adminApi.dispose(),
      ]);
      await server.stop();
      await resendServer?.stop();
    },
  };
}

async function createAuthenticatedContext(
  anonymousApi: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
) {
  const login = await loginAs(anonymousApi, email, password);
  return createApiContext(login.accessToken, baseURL);
}

async function reserveUnusedPort() {
  const server = net.createServer();

  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve an unused port'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}
