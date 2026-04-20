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
import { SmtpTestServer, type SmtpTestServerOptions } from './smtp-test-server';
import { isDeployedTarget } from './target-mode';

const prisma = new PrismaService();
const SUPPORT_ADMIN_EMAIL = 'support-admin@test.local';
const SUPPORT_FROM_EMAIL = 'support-bot@test.local';
const SMTP_PASSWORD = 'smtp-password';

type SupportHarness = {
  server: TemporaryApiServer;
  anonymousApi: APIRequestContext;
  memberApi: APIRequestContext;
  adminApi: APIRequestContext;
  smtpServer?: SmtpTestServer;
  stop: () => Promise<void>;
};

test.describe('Support Playwright API E2E', () => {
  test.skip(
    isDeployedTarget(),
    'Support Playwright tests require a temporary local SMTP server and per-process email env overrides.',
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
    defaultHarness.smtpServer?.clearMessages();
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

    const deliveredEmail = await defaultHarness.smtpServer?.waitForMessage();
    expect(deliveredEmail).toBeDefined();
    expect(deliveredEmail?.headers.to).toContain(SUPPORT_ADMIN_EMAIL);
    expect(deliveredEmail?.headers.from).toContain(SUPPORT_FROM_EMAIL);
    expect(deliveredEmail?.headers['reply-to']).toContain(
      seededUsers.member.email,
    );
    expect(deliveredEmail?.headers.subject).toContain(
      `[Support Feedback] ${subject}`,
    );
    const normalizedEmail = normalizeQuotedPrintable(deliveredEmail?.raw ?? '');
    expect(normalizedEmail).toContain('New Support Feedback');
    expect(normalizedEmail).toContain(seededUsers.member.email);
    expect(normalizedEmail).toContain(message);
  });

  test('allows admins to submit feedback and routes reply-to to the authenticated admin', async () => {
    const response = await defaultHarness.adminApi.post('support/feedback', {
      data: {
        subject: 'Front desk note',
        message: 'Reception needs more badge lanyards.',
      },
    });

    expect(response.status()).toBe(201);

    const email = await defaultHarness.smtpServer?.waitForMessage();
    expect(email?.headers['reply-to']).toContain(seededUsers.admin.email);

    const feedbackCount = await prisma.feedback.count({
      where: { userId: seededUsers.admin.id },
    });
    expect(feedbackCount).toBe(1);
  });

  test('falls back to EMAIL_USER as the sender when EMAIL_FROM is blank', async () => {
    const harness = await startSupportHarness({
      envOverrides: {
        EMAIL_FROM: '',
      },
    });

    try {
      const response = await harness.memberApi.post('support/feedback', {
        data: {
          subject: 'Blank sender fallback',
          message: 'The from header should fall back to the configured admin account.',
        },
      });

      expect(response.status()).toBe(201);

      const email = await harness.smtpServer?.waitForMessage();
      expect(email?.headers.from).toContain(SUPPORT_ADMIN_EMAIL);
      expect(email?.headers['reply-to']).toContain(seededUsers.member.email);
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

  test('persists feedback even when SMTP connections are refused', async () => {
    const unusedPort = await reserveUnusedPort();
    const harness = await startSupportHarness({
      skipSmtpServer: true,
      envOverrides: {
        EMAIL_HOST: '127.0.0.1',
        EMAIL_PORT: `${unusedPort}`,
        EMAIL_SECURE: 'false',
      },
    });

    try {
      const startedAt = Date.now();
      const response = await harness.memberApi.post('support/feedback', {
        data: {
          subject: 'SMTP refused',
          message: 'Saving feedback should not depend on the SMTP server being online.',
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
      expect(savedFeedback?.subject).toBe('SMTP refused');
    } finally {
      await harness.stop();
    }
  });

  test('returns immediately even when the SMTP server responds slowly after DATA', async () => {
    const harness = await startSupportHarness({
      smtpOptions: {
        afterDataDelayMs: 3_000,
      },
    });

    try {
      const startedAt = Date.now();
      const response = await harness.memberApi.post('support/feedback', {
        data: {
          subject: 'Slow SMTP',
          message: 'The HTTP response should not wait for the outbound email to finish.',
        },
      });
      const durationMs = Date.now() - startedAt;

      expect(response.status()).toBe(201);
      expect(durationMs).toBeLessThan(1_500);
      await harness.smtpServer?.waitForMessage();
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
  smtpOptions?: SmtpTestServerOptions;
  skipSmtpServer?: boolean;
} = {}): Promise<SupportHarness> {
  let smtpServer: SmtpTestServer | undefined;
  const envOverrides = {
    EMAIL_HOST: '127.0.0.1',
    EMAIL_PORT: '',
    EMAIL_SECURE: 'false',
    EMAIL_USER: SUPPORT_ADMIN_EMAIL,
    EMAIL_PASSWORD: SMTP_PASSWORD,
    EMAIL_FROM: SUPPORT_FROM_EMAIL,
    ...options.envOverrides,
  };

  if (!options.skipSmtpServer) {
    smtpServer = new SmtpTestServer(options.smtpOptions);
    await smtpServer.start();
    envOverrides.EMAIL_PORT = `${smtpServer.port}`;
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
    smtpServer,
    stop: async () => {
      await Promise.all([
        anonymousApi.dispose(),
        memberApi.dispose(),
        adminApi.dispose(),
      ]);
      await server.stop();
      await smtpServer?.stop();
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

function normalizeQuotedPrintable(value: string) {
  return value
    .replace(/=\r\n/g, '')
    .replace(/=20/g, ' ')
    .replace(/=3D/g, '=');
}
