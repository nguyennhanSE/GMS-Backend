import {
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import bcrypt from 'bcrypt';
import { spawn, type ChildProcess } from 'child_process';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../src/libs/config';
import { sha256Hash } from '../../src/utils/hash';
import {
  IS_DEPLOYED_PLAYWRIGHT_TARGET,
  PLAYWRIGHT_API_BASE_URL,
} from './target-mode';

export const API_BASE_URL = PLAYWRIGHT_API_BASE_URL;

const TEST_PASSWORD = 'PlaywrightApi@12345';
const TEST_EMAILS = {
  admin: 'playwright-admin@test.local',
  member: 'playwright-member@test.local',
} as const;
const MEMBERSHIP_PREFIX = 'Playwright Membership';
const REGISTER_EMAIL_PREFIX = 'playwright-register-';
const USER_EMAIL_PREFIX = 'playwright-user-';
const ROLE_PREFIX = 'PLAYWRIGHT_ROLE_';

export interface SeededUsers {
  admin: { id: string; email: string; password: string };
  member: { id: string; email: string; password: string };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

export interface TemporaryApiServer {
  baseURL: string;
  stop: () => Promise<void>;
}

const prisma = new PrismaService();
const jwtService = new JwtService();
let isDatabaseConnected = false;

export async function seedApiUsers(): Promise<SeededUsers> {
  await ensureDatabaseConnection();
  await cleanupApiTestData();

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const [adminRole, memberRole] = await Promise.all([
    ensureRole('ADMIN', 'Admin role'),
    ensureRole('MEMBER', 'Member role'),
  ]);

  const adminUser = await prisma.user.create({
    data: {
      firstName: 'Playwright',
      lastName: 'Admin',
      email: TEST_EMAILS.admin,
      password: hashedPassword,
      status: 'active',
      userRole: {
        create: {
          roleId: adminRole.id,
        },
      },
    },
  });

  const memberUser = await prisma.user.create({
    data: {
      firstName: 'Playwright',
      lastName: 'Member',
      email: TEST_EMAILS.member,
      password: hashedPassword,
      status: 'active',
      userRole: {
        create: {
          roleId: memberRole.id,
        },
      },
    },
  });

  return {
    admin: {
      id: adminUser.id,
      email: TEST_EMAILS.admin,
      password: TEST_PASSWORD,
    },
    member: {
      id: memberUser.id,
      email: TEST_EMAILS.member,
      password: TEST_PASSWORD,
    },
  };
}

export async function cleanupApiTestData() {
  await ensureDatabaseConnection();

  const seededEmails = Object.values(TEST_EMAILS);
  const registeredUsers = await prisma.user.findMany({
    where: {
      email: {
        startsWith: REGISTER_EMAIL_PREFIX,
      },
    },
    select: { id: true },
  });
  const managedUsers = await prisma.user.findMany({
    where: {
      email: {
        startsWith: USER_EMAIL_PREFIX,
      },
    },
    select: { id: true },
  });
  const seededUsers = await prisma.user.findMany({
    where: {
      email: {
        in: seededEmails,
      },
    },
    select: { id: true },
  });
  const userIds = [...seededUsers, ...registeredUsers, ...managedUsers].map(
    (user) => user.id,
  );
  const memberships = await prisma.membership.findMany({
    where: {
      name: {
        startsWith: MEMBERSHIP_PREFIX,
      },
    },
    select: { id: true },
  });
  const membershipIds = memberships.map((membership) => membership.id);
  const roles = await prisma.role.findMany({
    where: {
      name: {
        startsWith: ROLE_PREFIX,
      },
    },
    select: { id: true },
  });
  const roleIds = roles.map((role) => role.id);

  const paymentCleanupFilters: Prisma.PaymentWhereInput[] = [];
  if (userIds.length > 0) {
    paymentCleanupFilters.push({ userId: { in: userIds } });
  }
  if (membershipIds.length > 0) {
    paymentCleanupFilters.push({
      targetType: 'MEMBERSHIP',
      targetId: { in: membershipIds },
    });
  }

  if (paymentCleanupFilters.length > 0) {
    await prisma.payment.deleteMany({
      where: {
        OR: paymentCleanupFilters,
      },
    });
  }

  await prisma.userMembership.deleteMany({
    where: {
      OR: [
        {
          user: {
            email: {
              in: seededEmails,
            },
          },
        },
        {
          user: {
            email: {
              startsWith: REGISTER_EMAIL_PREFIX,
            },
          },
        },
        {
          user: {
            email: {
              startsWith: USER_EMAIL_PREFIX,
            },
          },
        },
        {
          membership: {
            name: {
              startsWith: MEMBERSHIP_PREFIX,
            },
          },
        },
      ],
    },
  });

  await prisma.session.deleteMany({
    where: {
      OR: [
        {
          user: {
            email: {
              in: seededEmails,
            },
          },
        },
        {
          user: {
            email: {
              startsWith: REGISTER_EMAIL_PREFIX,
            },
          },
        },
        {
          user: {
            email: {
              startsWith: USER_EMAIL_PREFIX,
            },
          },
        },
      ],
    },
  });

  const userRoleCleanupFilters: Prisma.UserRoleWhereInput[] = [
    {
      user: {
        email: {
          in: seededEmails,
        },
      },
    },
    {
      user: {
        email: {
          startsWith: REGISTER_EMAIL_PREFIX,
        },
      },
    },
    {
      user: {
        email: {
          startsWith: USER_EMAIL_PREFIX,
        },
      },
    },
  ];
  if (roleIds.length > 0) {
    userRoleCleanupFilters.push({ roleId: { in: roleIds } });
  }

  await prisma.userRole.deleteMany({
    where: {
      OR: userRoleCleanupFilters,
    },
  });

  await prisma.user.deleteMany({
    where: {
      OR: [
        {
          email: {
            in: seededEmails,
          },
        },
        {
          email: {
            startsWith: REGISTER_EMAIL_PREFIX,
          },
        },
        {
          email: {
            startsWith: USER_EMAIL_PREFIX,
          },
        },
      ],
    },
  });

  await prisma.role.deleteMany({
    where: {
      name: {
        startsWith: ROLE_PREFIX,
      },
    },
  });

  await prisma.membership.deleteMany({
    where: {
      name: {
        startsWith: MEMBERSHIP_PREFIX,
      },
    },
  });
}

export async function disconnectDatabase() {
  if (!isDatabaseConnected) {
    return;
  }

  await prisma.$disconnect();
  isDatabaseConnected = false;
}

export async function cleanupGeneratedApiTestData() {
  await ensureDatabaseConnection();

  const users = await prisma.user.findMany({
    where: {
      OR: [
        {
          email: {
            startsWith: REGISTER_EMAIL_PREFIX,
          },
        },
        {
          email: {
            startsWith: USER_EMAIL_PREFIX,
          },
        },
      ],
    },
    select: { id: true },
  });
  const roles = await prisma.role.findMany({
    where: {
      name: {
        startsWith: ROLE_PREFIX,
      },
    },
    select: { id: true },
  });

  const userIds = users.map((user) => user.id);
  const roleIds = roles.map((role) => role.id);

  if (userIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.userMembership.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: userIds } },
    });
  }

  if (userIds.length > 0 || roleIds.length > 0) {
    const userRoleFilters: Prisma.UserRoleWhereInput[] = [];
    if (userIds.length > 0) {
      userRoleFilters.push({ userId: { in: userIds } });
    }
    if (roleIds.length > 0) {
      userRoleFilters.push({ roleId: { in: roleIds } });
    }

    await prisma.userRole.deleteMany({
      where: {
        OR: userRoleFilters,
      },
    });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }

  if (roleIds.length > 0) {
    await prisma.role.deleteMany({
      where: { id: { in: roleIds } },
    });
  }
}

export async function clearMembershipsForUser(userId: string) {
  await ensureDatabaseConnection();

  await prisma.payment.deleteMany({
    where: {
      userId,
      targetType: 'MEMBERSHIP',
    },
  });

  await prisma.userMembership.deleteMany({
    where: { userId },
  });
}

export async function assignMembershipToUser(
  userId: string,
  membershipId: string,
) {
  await ensureDatabaseConnection();

  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
  });

  if (!membership) {
    throw new Error(`Membership ${membershipId} not found`);
  }

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);

  return prisma.userMembership.create({
    data: {
      userId,
      membershipId,
      membershipName: membership.name,
      membershipDescription: membership.description ?? '',
      level: membership.level,
      status: 'normal',
      startDate,
      endDate,
    },
    include: {
      membership: true,
    },
  });
}

export async function updateUserStatus(userId: string, status: string) {
  await ensureDatabaseConnection();

  await prisma.user.update({
    where: { id: userId },
    data: { status },
  });
}

export async function countSessionsForUser(userId: string) {
  await ensureDatabaseConnection();

  return prisma.session.count({
    where: { userId },
  });
}

export async function getLatestSessionForUser(userId: string) {
  await ensureDatabaseConnection();

  return prisma.session.findFirst({
    where: { userId },
    orderBy: { expiredAt: 'desc' },
  });
}

export async function getRefreshTokenReuseCountForUser(userId: string) {
  await ensureDatabaseConnection();

  return prisma.refreshTokenUsed.count({
    where: {
      session: { userId },
    },
  });
}

export async function findUserByEmail(email: string) {
  await ensureDatabaseConnection();

  return prisma.user.findUnique({
    where: { email },
  });
}

export async function getUserRoleNames(userId: string) {
  await ensureDatabaseConnection();

  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: true },
  });

  return roles.map((item) => item.role.name);
}

export async function createEmailVerificationToken(params: {
  userId: string;
  email: string;
  mode?: 'setup_password' | 'activate_only';
}) {
  return jwtService.signAsync(
    {
      sub: params.userId,
      email: params.email,
      purpose: 'user-email-verification',
      mode: params.mode ?? 'activate_only',
    },
    {
      secret: config.JWT_SECRET_ACCESS_TOKEN,
      expiresIn: config.JWT_TOKEN_EXPIRATION_TIME as any,
    },
  );
}

export function createRegisterPayload() {
  const suffix = createUniqueSuffix();

  return {
    firstName: 'Playwright',
    lastName: 'Registered',
    email: `${REGISTER_EMAIL_PREFIX}${suffix}@test.local`,
    password: TEST_PASSWORD,
    confirmPassword: TEST_PASSWORD,
  } as const;
}

export function createUserPayload(
  overrides: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    role: 'ADMIN' | 'MEMBER';
    phone: string;
    gender: string;
    address: string;
  }> = {},
) {
  const suffix = createUniqueSuffix();

  return {
    firstName: 'Playwright',
    lastName: `User ${suffix}`,
    email: `${USER_EMAIL_PREFIX}${suffix}@test.local`,
    phone: '010-1234-5678',
    gender: 'other',
    address: `API test address ${suffix}`,
    ...overrides,
  } as const;
}

export async function createApiRole(overrides?: {
  name?: string;
  description?: string;
}) {
  await ensureDatabaseConnection();

  const suffix = createUniqueSuffix();
  return prisma.role.create({
    data: {
      name: overrides?.name ?? `${ROLE_PREFIX}${suffix}`,
      description: overrides?.description ?? `Playwright role ${suffix}`,
    },
  });
}

export function decodeJwtPayload<T>(token: string): T {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as T;
}

export function hashRefreshToken(token: string) {
  return sha256Hash(token);
}

export function createStripeWebhookEvent(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: config.STRIPE_WEBHOOK_SECRET,
  });

  return { body, signature };
}

export async function findMembershipPaymentForUser(
  userId: string,
  membershipId: string,
) {
  await ensureDatabaseConnection();

  return prisma.payment.findFirst({
    where: {
      userId,
      targetType: 'MEMBERSHIP',
      targetId: membershipId,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findMembershipRecordByPaymentId(paymentId: string) {
  await ensureDatabaseConnection();

  return prisma.userMembership.findFirst({
    where: { paymentId },
    include: { membership: true },
  });
}

export async function listMembershipRecordsForUser(userId: string) {
  await ensureDatabaseConnection();

  return prisma.userMembership.findMany({
    where: { userId },
    include: { membership: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function loginAs(
  api: APIRequestContext,
  username: string,
  password: string,
): Promise<LoginResult> {
  const response = await api.post('auth/login', {
    data: {
      username,
      password,
    },
  });

  if (!response.ok()) {
    throw new Error(`Login failed for ${username}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    data?: { accessToken?: string; refreshToken?: string };
  };
  const accessToken = body.data?.accessToken;
  const refreshToken = body.data?.refreshToken;

  if (!accessToken || !refreshToken) {
    throw new Error(`Missing auth tokens for ${username}`);
  }

  return {
    accessToken,
    refreshToken,
  };
}

export async function createApiContext(
  token?: string,
  baseURL: string = API_BASE_URL,
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: token
      ? {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        }
      : {
          Accept: 'application/json',
        },
  });
}

export function createMembershipPayload() {
  const suffix = createUniqueSuffix();

  return {
    name: `${MEMBERSHIP_PREFIX} ${suffix}`,
    description: `API CRUD ${suffix}`,
    minPrice: 100_000,
    purchasePrice: 120_000,
    level: 'PREMIUM',
  } as const;
}

export async function startTemporaryApiServer(
  envOverrides: Record<string, string>,
): Promise<TemporaryApiServer> {
  if (IS_DEPLOYED_PLAYWRIGHT_TARGET) {
    throw new Error(
      'startTemporaryApiServer is local-only and cannot be used when PLAYWRIGHT_TARGET=deployed.',
    );
  }

  const port = `${3200 + Math.floor(Math.random() * 300)}`;
  const baseURL = `http://127.0.0.1:${port}/api/v1/`;
  const child = spawn(
    process.execPath,
    [
      '-r',
      'ts-node/register/transpile-only',
      '-r',
      'tsconfig-paths/register',
      'test/playwright/server.ts',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAYWRIGHT_API_PORT: port,
        ...envOverrides,
      },
      stdio: 'pipe',
    },
  );

  const output = captureChildOutput(child);

  try {
    await waitForApiServer(baseURL, child);
  } catch (error) {
    await stopChildProcess(child);
    throw new Error(
      `Temporary API server failed to start.\nSTDOUT:\n${output.stdout}\nSTDERR:\n${output.stderr}\nCAUSE: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    baseURL,
    stop: async () => {
      await stopChildProcess(child);
    },
  };
}

function createUniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function captureChildOutput(child: ChildProcess) {
  const output = {
    stdout: '',
    stderr: '',
  };

  child.stdout?.on('data', (chunk: Buffer | string) => {
    output.stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    output.stderr += chunk.toString();
  });

  return output;
}

async function waitForApiServer(baseURL: string, child: ChildProcess) {
  const deadline = Date.now() + 60_000;
  const api = await playwrightRequest.newContext({ baseURL });

  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`server exited early with code ${child.exitCode}`);
      }

      try {
        const response = await api.get('health');
        if (response.ok()) {
          return;
        }
      } catch {
        // Ignore transient startup errors while the temporary server is booting.
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('timed out waiting for health endpoint');
  } finally {
    await api.dispose();
  }
}

async function stopChildProcess(child: ChildProcess) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 5_000);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill('SIGTERM');
  });
}

async function ensureRole(name: string, description: string) {
  const existing = await prisma.role.findUnique({
    where: { name },
  });

  if (existing) {
    return existing;
  }

  return prisma.role.create({
    data: { name, description },
  });
}

async function ensureDatabaseConnection() {
  if (isDatabaseConnected) {
    return;
  }

  await prisma.$connect();
  isDatabaseConnected = true;
}
