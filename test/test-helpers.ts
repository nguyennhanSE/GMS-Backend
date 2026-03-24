import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Test data IDs - populated by createTestData()
 */
export interface TestData {
  memberUser: { id: string; email: string };
  adminUser: { id: string; email: string };
  trainerUser: { id: string; email: string };
  testClass: { id: string; className: string };
  testSchedule: { id: string };
  memberPassword: string;
  adminPassword: string;
  trainerPassword: string;
}

/**
 * Login and return access token for a user
 */
export async function loginAs(
  app: INestApplication,
  username: string,
  password: string,
): Promise<string> {
  const response = await supertest
    .default(app.getHttpServer())
    .post('/auth/login')
    .send({ username, password })
    .expect(201);

  const accessToken = response.body?.data?.accessToken as string;
  if (!accessToken) {
    throw new Error(
      `Login failed for ${username}: ${JSON.stringify(response.body)}`,
    );
  }
  return accessToken;
}

/**
 * Make authenticated request
 */
export function authRequest(app: INestApplication, token: string) {
  return {
    get: (url: string) =>
      supertest
        .default(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      supertest
        .default(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${token}`),
    patch: (url: string) =>
      supertest
        .default(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${token}`),
    delete: (url: string) =>
      supertest
        .default(app.getHttpServer())
        .delete(url)
        .set('Authorization', `Bearer ${token}`),
  };
}

/**
 * Extract error message from ResponseModel structure
 * Handles both direct message and error.message patterns
 */
export function getErrorMessage(body: any): string {
  // Try error.message first (ResponseModel wrapper)
  if (body?.error?.message) {
    const msg = body.error.message;
    return Array.isArray(msg) ? msg.join(' ') : String(msg);
  }
  // Fall back to direct message
  if (body?.message) {
    const msg = body.message;
    return Array.isArray(msg) ? msg.join(' ') : String(msg);
  }
  return '';
}

/**
 * Create test data for integration tests
 */
export async function createTestData(prisma: PrismaService): Promise<TestData> {
  const testPassword = 'Test@12345';
  // Hash password properly using bcrypt
  const hashedPassword = await bcrypt.hash(testPassword, 10);

  await cleanupTestData(prisma);

  // Get or create roles (UPPERCASE to match ERoleName enum)
  let memberRole = await prisma.role.findFirst({ where: { name: 'MEMBER' } });
  let adminRole = await prisma.role.findFirst({ where: { name: 'ADMIN' } });
  let trainerRole = await prisma.role.findFirst({ where: { name: 'TRAINER' } });

  if (!memberRole) {
    memberRole = await prisma.role.create({
      data: { name: 'MEMBER', description: 'Member role' },
    });
  }
  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: { name: 'ADMIN', description: 'Admin role' },
    });
  }
  if (!trainerRole) {
    trainerRole = await prisma.role.create({
      data: { name: 'TRAINER', description: 'Trainer role' },
    });
  }

  // Delete existing test users first (to ensure clean roles)
  const testEmails = [
    'api-test-member@test.local',
    'api-test-admin@test.local',
    'api-test-trainer@test.local',
  ];

  // Delete sessions first
  await prisma.session.deleteMany({
    where: { user: { email: { in: testEmails } } },
  });

  // Delete user roles
  await prisma.userRole.deleteMany({
    where: { user: { email: { in: testEmails } } },
  });

  // Delete users
  await prisma.user.deleteMany({
    where: { email: { in: testEmails } },
  });

  // Create test member
  const memberUser = await prisma.user.create({
    data: {
      firstName: 'API Test',
      lastName: 'Member',
      email: 'api-test-member@test.local',
      password: hashedPassword,
      status: 'active',
      userRole: {
        create: { roleId: memberRole.id },
      },
    },
  });

  // Create test admin
  const adminUser = await prisma.user.create({
    data: {
      firstName: 'API Test',
      lastName: 'Admin',
      email: 'api-test-admin@test.local',
      password: hashedPassword,
      status: 'active',
      userRole: {
        create: { roleId: adminRole.id },
      },
    },
  });

  // Create test trainer
  const trainerUser = await prisma.user.create({
    data: {
      firstName: 'API Test',
      lastName: 'Trainer',
      email: 'api-test-trainer@test.local',
      password: hashedPassword,
      status: 'active',
      userRole: {
        create: { roleId: trainerRole.id },
      },
    },
  });

  // Create test class
  const testClass = await prisma.gymClass.upsert({
    where: { className: 'API Integration Test Class' },
    update: {},
    create: {
      className: 'API Integration Test Class',
      description: 'Class for API integration testing',
      difficultyLevel: 'Beginner',
      category: 'Testing',
      isActive: true,
    },
  });

  // Create test schedule (Monday at 10:00-11:00)
  let testSchedule = await prisma.classSchedule.findFirst({
    where: {
      classId: testClass.id,
      trainerId: trainerUser.id,
    },
  });

  if (!testSchedule) {
    testSchedule = await prisma.classSchedule.create({
      data: {
        classId: testClass.id,
        trainerId: trainerUser.id,
        dayOfWeek: 'MON',
        startTime: new Date('1970-01-01T10:00:00Z'),
        endTime: new Date('1970-01-01T11:00:00Z'),
        capacity: 5,
        isActive: true,
        location: 'Test Studio A',
      },
    });
  }

  // Create trainer availability for Monday 10:00-11:00
  await prisma.trainerAvailability.deleteMany({
    where: { trainerId: trainerUser.id },
  });
  await prisma.trainerAvailability.create({
    data: {
      trainerId: trainerUser.id,
      dayOfWeek: 1, // Monday
      startTime: new Date('1970-01-01T10:00:00Z'),
      endTime: new Date('1970-01-01T11:00:00Z'),
      isAvailable: true,
    },
  });

  return {
    memberUser: { id: memberUser.id, email: memberUser.email },
    adminUser: { id: adminUser.id, email: adminUser.email },
    trainerUser: { id: trainerUser.id, email: trainerUser.email },
    testClass: { id: testClass.id, className: testClass.className },
    testSchedule: { id: testSchedule.id },
    memberPassword: testPassword,
    adminPassword: testPassword,
    trainerPassword: testPassword,
  };
}

/**
 * Cleanup test data
 */
export async function cleanupTestData(prisma: PrismaService): Promise<void> {
  const testEmails = [
    'api-test-member@test.local',
    'api-test-admin@test.local',
    'api-test-trainer@test.local',
  ];

  // Delete bookings
  await prisma.classBooking.deleteMany({
    where: {
      user: { email: { in: testEmails } },
    },
  });

  // Delete exceptions
  await prisma.scheduleException.deleteMany({
    where: {
      schedule: {
        gymClass: { className: 'API Integration Test Class' },
      },
    },
  });

  // Delete schedule days
  await prisma.scheduleDay.deleteMany({
    where: {
      schedule: {
        gymClass: { className: 'API Integration Test Class' },
      },
    },
  });

  // Delete schedules
  await prisma.classSchedule.deleteMany({
    where: {
      gymClass: { className: 'API Integration Test Class' },
    },
  });

  // Delete class
  await prisma.gymClass.deleteMany({
    where: { className: 'API Integration Test Class' },
  });

  // Delete sessions
  await prisma.session.deleteMany({
    where: { user: { email: { in: testEmails } } },
  });

  // Delete payments
  await prisma.payment.deleteMany({
    where: { user: { email: { in: testEmails } } },
  });

  // Delete user roles
  await prisma.userRole.deleteMany({
    where: { user: { email: { in: testEmails } } },
  });

  // Delete users
  await prisma.user.deleteMany({
    where: { email: { in: testEmails } },
  });
}

/**
 * Get next occurrence of a day of week (UTC-safe)
 */
export function getNextDayOfWeek(dayOfWeek: string): Date {
  const days: Record<string, number> = {
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
  };

  const targetDay = days[dayOfWeek] ?? 1;
  const today = new Date();
  const currentDay = today.getUTCDay(); // Use UTC day
  const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7;

  const nextDate = new Date(today);
  nextDate.setUTCDate(today.getUTCDate() + daysUntilTarget);
  nextDate.setUTCHours(12, 0, 0, 0); // Set to noon UTC to avoid timezone issues

  return nextDate;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
