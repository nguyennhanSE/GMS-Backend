import bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

const TEST_PASSWORD = 'PlaywrightWorkout@12345';
const TEST_EMAILS = {
  trainer: 'playwright-workout-trainer@test.local',
  member: 'playwright-workout-member@test.local',
  otherMember: 'playwright-workout-member-2@test.local',
} as const;

export const WORKOUT_PREFIX = 'Playwright Workout';

export interface SeededWorkoutUsers {
  trainer: { id: string; email: string; password: string };
  member: { id: string; email: string; password: string };
  otherMember: { id: string; email: string; password: string };
}

const prisma = new PrismaService();
let isDatabaseConnected = false;

export async function seedWorkoutApiUsers(): Promise<SeededWorkoutUsers> {
  await ensureDatabaseConnection();
  await cleanupWorkoutApiTestData();

  const [trainerRole, memberRole] = await Promise.all([
    ensureRole('TRAINER', 'Trainer role'),
    ensureRole('MEMBER', 'Member role'),
  ]);
  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);

  const [trainerUser, memberUser, otherMemberUser] = await Promise.all([
    prisma.user.create({
      data: {
        firstName: 'Playwright',
        lastName: 'Workout Trainer',
        email: TEST_EMAILS.trainer,
        password: hashedPassword,
        status: 'active',
        userRole: {
          create: {
            roleId: trainerRole.id,
          },
        },
      },
    }),
    prisma.user.create({
      data: {
        firstName: 'Playwright',
        lastName: 'Workout Member',
        email: TEST_EMAILS.member,
        password: hashedPassword,
        status: 'active',
        userRole: {
          create: {
            roleId: memberRole.id,
          },
        },
      },
    }),
    prisma.user.create({
      data: {
        firstName: 'Playwright',
        lastName: 'Workout Member Two',
        email: TEST_EMAILS.otherMember,
        password: hashedPassword,
        status: 'active',
        userRole: {
          create: {
            roleId: memberRole.id,
          },
        },
      },
    }),
  ]);

  return {
    trainer: {
      id: trainerUser.id,
      email: trainerUser.email,
      password: TEST_PASSWORD,
    },
    member: {
      id: memberUser.id,
      email: memberUser.email,
      password: TEST_PASSWORD,
    },
    otherMember: {
      id: otherMemberUser.id,
      email: otherMemberUser.email,
      password: TEST_PASSWORD,
    },
  };
}

export async function cleanupWorkoutDomainData() {
  await ensureDatabaseConnection();

  const userIds = await getSeededUserIds();
  if (userIds.length > 0) {
    await prisma.workoutSession.deleteMany({
      where: {
        memberId: {
          in: userIds,
        },
      },
    });

    await prisma.workoutPlan.deleteMany({
      where: {
        trainerId: {
          in: userIds,
        },
      },
    });
  }

  await prisma.exercise.deleteMany({
    where: {
      name: {
        startsWith: WORKOUT_PREFIX,
      },
    },
  });
}

export async function cleanupWorkoutApiTestData() {
  await ensureDatabaseConnection();
  await cleanupWorkoutDomainData();

  const userIds = await getSeededUserIds();
  if (userIds.length === 0) {
    return;
  }

  await prisma.session.deleteMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });

  await prisma.userRole.deleteMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });

  await prisma.user.deleteMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
}

export async function disconnectWorkoutDatabase() {
  if (!isDatabaseConnected) {
    return;
  }

  await prisma.$disconnect();
  isDatabaseConnected = false;
}

async function getSeededUserIds() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: Object.values(TEST_EMAILS),
      },
    },
    select: {
      id: true,
    },
  });

  return users.map((user) => user.id);
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
