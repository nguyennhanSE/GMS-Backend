import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function loadProductionEnv() {
  dotenv.config({ path: '.env.prod' });
}

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const memberships = [
  {
    name: 'Basic',
    description: 'Access to gym during staffed hours',
    minPrice: 199000,
    purchasePrice: 199000,
    level: 'BASIC' as const,
  },
  {
    name: 'Premium',
    description: '24/7 access + group classes',
    minPrice: 399000,
    purchasePrice: 399000,
    level: 'PREMIUM' as const,
  },
  {
    name: 'VIP',
    description: '24/7 access + all classes + personal training sessions',
    minPrice: 799000,
    purchasePrice: 799000,
    level: 'ELITE' as const,
  },
  {
    name: 'Student',
    description: 'Discounted membership for students with valid ID',
    minPrice: 149000,
    purchasePrice: 149000,
    level: 'BASIC' as const,
  },
  {
    name: 'Senior',
    description: 'Special rate for seniors 60+',
    minPrice: 129000,
    purchasePrice: 129000,
    level: 'BASIC' as const,
  },
  {
    name: 'Day Pass',
    description: 'Single day access',
    minPrice: 50000,
    purchasePrice: 50000,
    level: 'BASIC' as const,
  },
];

const gymClasses = [
  {
    className: 'Yoga - Beginner',
    description: 'Beginner-friendly yoga flow',
    category: 'Yoga',
    difficultyLevel: 'Beginner' as const,
  },
  {
    className: 'Yoga - Advanced',
    description: 'Advanced yoga techniques and poses',
    category: 'Yoga',
    difficultyLevel: 'Advanced' as const,
  },
  {
    className: 'HIIT - 30min',
    description: 'High intensity interval training',
    category: 'Cardio',
    difficultyLevel: 'Intermediate' as const,
  },
  {
    className: 'HIIT - 45min',
    description: 'Extended high intensity interval training',
    category: 'Cardio',
    difficultyLevel: 'Advanced' as const,
  },
  {
    className: 'Strength Training',
    description: 'Full-body strength session',
    category: 'Strength',
    difficultyLevel: 'Intermediate' as const,
  },
  {
    className: 'Pilates',
    description: 'Core strengthening and flexibility',
    category: 'Flexibility',
    difficultyLevel: 'Beginner' as const,
  },
  {
    className: 'Zumba',
    description: 'Dance fitness party',
    category: 'Dance',
    difficultyLevel: 'Beginner' as const,
  },
  {
    className: 'Spinning',
    description: 'Indoor cycling workout',
    category: 'Cardio',
    difficultyLevel: 'Intermediate' as const,
  },
  {
    className: 'Boxing',
    description: 'Cardio boxing and technique',
    category: 'Combat',
    difficultyLevel: 'Intermediate' as const,
  },
  {
    className: 'CrossFit',
    description: 'Functional fitness workout',
    category: 'Functional',
    difficultyLevel: 'Advanced' as const,
  },
  {
    className: 'Stretching & Mobility',
    description: 'Improve flexibility and recovery',
    category: 'Flexibility',
    difficultyLevel: 'Beginner' as const,
  },
  {
    className: 'BodyPump',
    description: 'Barbell workout for full body',
    category: 'Strength',
    difficultyLevel: 'Intermediate' as const,
  },
];

const exercises = [
  {
    name: 'Back Squat',
    description: 'Barbell squat emphasizing quadriceps and glutes.',
    category: 'Strength',
    equipmentRequired: 'Barbell',
  },
  {
    name: 'Bench Press',
    description: 'Horizontal press targeting chest, shoulders, and triceps.',
    category: 'Strength',
    equipmentRequired: 'Barbell',
  },
  {
    name: 'Deadlift',
    description: 'Hip hinge compound lift for posterior chain strength.',
    category: 'Strength',
    equipmentRequired: 'Barbell',
  },
  {
    name: 'Overhead Press',
    description: 'Standing barbell press for shoulders and triceps.',
    category: 'Strength',
    equipmentRequired: 'Barbell',
  },
  {
    name: 'Pull-Up',
    description: 'Vertical pulling movement for back and arms.',
    category: 'Strength',
    equipmentRequired: 'Pull-up Bar',
  },
  {
    name: 'Barbell Row',
    description: 'Bent-over row for lats, rhomboids, and rear delts.',
    category: 'Strength',
    equipmentRequired: 'Barbell',
  },
  {
    name: 'Walking Lunge',
    description: 'Unilateral lower-body movement for legs and stability.',
    category: 'Strength',
    equipmentRequired: 'Dumbbells',
  },
  {
    name: 'Leg Press',
    description: 'Machine-based lower body pressing movement.',
    category: 'Strength',
    equipmentRequired: 'Leg Press Machine',
  },
  {
    name: 'Hack Squat',
    description: 'Machine squat variation often used as a squat substitute.',
    category: 'Strength',
    equipmentRequired: 'Hack Squat Machine',
  },
  {
    name: 'Plank',
    description: 'Isometric core bracing exercise.',
    category: 'Core',
    equipmentRequired: 'Bodyweight',
  },
];

async function main() {
  loadProductionEnv();
  const databaseUrl = assertEnv('DATABASE_URL');

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    await Promise.all([
      prisma.role.upsert({
        where: { name: 'ADMIN' },
        update: { description: 'System administrator' },
        create: { name: 'ADMIN', description: 'System administrator' },
      }),
      prisma.role.upsert({
        where: { name: 'STAFF' },
        update: { description: 'Gym staff' },
        create: { name: 'STAFF', description: 'Gym staff' },
      }),
      prisma.role.upsert({
        where: { name: 'TRAINER' },
        update: { description: 'Gym trainer/instructor' },
        create: { name: 'TRAINER', description: 'Gym trainer/instructor' },
      }),
      prisma.role.upsert({
        where: { name: 'MEMBER' },
        update: { description: 'Gym member' },
        create: { name: 'MEMBER', description: 'Gym member' },
      }),
    ]);

    await Promise.all(
      memberships.map((membership) =>
        prisma.membership.upsert({
          where: { name: membership.name },
          update: {
            description: membership.description,
            minPrice: membership.minPrice,
            purchasePrice: membership.purchasePrice,
            level: membership.level,
          },
          create: membership,
        }),
      ),
    );

    await Promise.all(
      gymClasses.map((gymClass) =>
        prisma.gymClass.upsert({
          where: { className: gymClass.className },
          update: {
            description: gymClass.description,
            category: gymClass.category,
            difficultyLevel: gymClass.difficultyLevel,
            isActive: true,
          },
          create: {
            ...gymClass,
            isActive: true,
          },
        }),
      ),
    );

    await Promise.all(
      exercises.map((exercise) =>
        prisma.exercise.upsert({
          where: { name: exercise.name },
          update: {
            description: exercise.description,
            category: exercise.category,
            equipmentRequired: exercise.equipmentRequired,
          },
          create: exercise,
        }),
      ),
    );

    console.log('✅ Production baseline seed completed');
    console.log('- Roles: ADMIN, STAFF, TRAINER, MEMBER');
    console.log(`- Membership tiers: ${memberships.length}`);
    console.log(`- Gym class templates: ${gymClasses.length}`);
    console.log(`- Exercises: ${exercises.length}`);
    console.log(
      '- No users, trainer availability, schedules, bookings, or live memberships were modified',
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Production baseline seed failed:', error);
  process.exitCode = 1;
});
