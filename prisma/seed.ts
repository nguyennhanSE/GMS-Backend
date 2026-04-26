import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function loadEnv() {
  // Keep env-loading consistent with `prisma.config.ts`
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const envFile = NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
  dotenv.config({ path: envFile });
}

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@gym.local';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
const SEED_ADMIN_FIRST_NAME = process.env.SEED_ADMIN_FIRST_NAME || 'System';
const SEED_ADMIN_LAST_NAME = process.env.SEED_ADMIN_LAST_NAME || 'Admin';

const SEED_MEMBER_EMAIL = process.env.SEED_MEMBER_EMAIL || 'member@gym.local';
const SEED_MEMBER_PASSWORD =
  process.env.SEED_MEMBER_PASSWORD || 'Member@123456';

const SEED_TRAINER_EMAIL =
  process.env.SEED_TRAINER_EMAIL || 'trainer@gym.local';
const SEED_TRAINER_PASSWORD =
  process.env.SEED_TRAINER_PASSWORD || 'Trainer@123456';

// Additional seed data
const SEED_USERS_PASSWORD = 'Password@123456';

async function ensureUserMembership(params: {
  prisma: PrismaClient;
  userId: string;
  membershipId: string;
  membershipName: string;
  membershipDescription: string | null;
  status?: string;
  startDate: Date;
  endDate: Date;
  updatedByAdmin?: boolean;
}) {
  const { prisma, userId, membershipId } = params;
  const existing = await prisma.userMembership.findFirst({
    where: { userId, membershipId },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.userMembership.create({
    data: {
      userId,
      membershipId,
      membershipName: params.membershipName,
      membershipDescription: params.membershipDescription ?? '',
      status: params.status ?? 'normal',
      startDate: params.startDate,
      endDate: params.endDate,
      updatedByAdmin: params.updatedByAdmin ?? false,
    },
    select: { id: true },
  });
}

async function main() {
  loadEnv();
  const databaseUrl = assertEnv('DATABASE_URL');

  // Initialize PrismaClient with PostgreSQL adapter (same as PrismaService)
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const now = new Date();
  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);

  // 1) Roles
  const [adminRole, staffRole, trainerRole, memberRole] = await Promise.all([
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

  // 2) Memberships
  const [
    basicMembership,
    premiumMembership,
    vipMembership,
    studentMembership,
    seniorMembership,
    dayPassMembership,
  ] = await Promise.all([
    prisma.membership.upsert({
      where: { name: 'Basic' },
      update: {
        description: 'Access to gym during staffed hours',
        minPrice: 199000,
        level: 'BASIC',
      },
      create: {
        name: 'Basic',
        description: 'Access to gym during staffed hours',
        minPrice: 199000,
        level: 'BASIC',
      },
    }),
    prisma.membership.upsert({
      where: { name: 'Premium' },
      update: {
        description: '24/7 access + group classes',
        minPrice: 399000,
        level: 'PREMIUM',
      },
      create: {
        name: 'Premium',
        description: '24/7 access + group classes',
        minPrice: 399000,
        level: 'PREMIUM',
      },
    }),
    prisma.membership.upsert({
      where: { name: 'VIP' },
      update: {
        description: '24/7 access + all classes + personal training sessions',
        minPrice: 799000,
        level: 'ELITE',
      },
      create: {
        name: 'VIP',
        description: '24/7 access + all classes + personal training sessions',
        minPrice: 799000,
        level: 'ELITE',
      },
    }),
    prisma.membership.upsert({
      where: { name: 'Student' },
      update: {
        description: 'Discounted membership for students with valid ID',
        minPrice: 149000,
        level: 'BASIC',
      },
      create: {
        name: 'Student',
        description: 'Discounted membership for students with valid ID',
        minPrice: 149000,
        level: 'BASIC',
      },
    }),
    prisma.membership.upsert({
      where: { name: 'Senior' },
      update: {
        description: 'Special rate for seniors 60+',
        minPrice: 129000,
        level: 'BASIC',
      },
      create: {
        name: 'Senior',
        description: 'Special rate for seniors 60+',
        minPrice: 129000,
        level: 'BASIC',
      },
    }),
    prisma.membership.upsert({
      where: { name: 'Day Pass' },
      update: {
        description: 'Single day access',
        minPrice: 50000,
        level: 'BASIC',
      },
      create: {
        name: 'Day Pass',
        description: 'Single day access',
        minPrice: 50000,
        level: 'BASIC',
      },
    }),
  ]);

  // 3) Gym Classes (class templates/definitions)
  const gymClasses = await Promise.all([
    prisma.gymClass.upsert({
      where: { className: 'Yoga - Beginner' },
      update: {
        description: 'Beginner-friendly yoga flow',
        category: 'Yoga',
        difficultyLevel: 'Beginner',
      },
      create: {
        className: 'Yoga - Beginner',
        description: 'Beginner-friendly yoga flow',
        category: 'Yoga',
        difficultyLevel: 'Beginner',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'Yoga - Advanced' },
      update: {
        description: 'Advanced yoga techniques and poses',
        category: 'Yoga',
        difficultyLevel: 'Advanced',
      },
      create: {
        className: 'Yoga - Advanced',
        description: 'Advanced yoga techniques and poses',
        category: 'Yoga',
        difficultyLevel: 'Advanced',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'HIIT - 30min' },
      update: {
        description: 'High intensity interval training',
        category: 'Cardio',
        difficultyLevel: 'Intermediate',
      },
      create: {
        className: 'HIIT - 30min',
        description: 'High intensity interval training',
        category: 'Cardio',
        difficultyLevel: 'Intermediate',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'HIIT - 45min' },
      update: {
        description: 'Extended high intensity interval training',
        category: 'Cardio',
        difficultyLevel: 'Advanced',
      },
      create: {
        className: 'HIIT - 45min',
        description: 'Extended high intensity interval training',
        category: 'Cardio',
        difficultyLevel: 'Advanced',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'Strength Training' },
      update: {
        description: 'Full-body strength session',
        category: 'Strength',
        difficultyLevel: 'Intermediate',
      },
      create: {
        className: 'Strength Training',
        description: 'Full-body strength session',
        category: 'Strength',
        difficultyLevel: 'Intermediate',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'Pilates' },
      update: {
        description: 'Core strengthening and flexibility',
        category: 'Flexibility',
        difficultyLevel: 'Beginner',
      },
      create: {
        className: 'Pilates',
        description: 'Core strengthening and flexibility',
        category: 'Flexibility',
        difficultyLevel: 'Beginner',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'Zumba' },
      update: {
        description: 'Dance fitness party',
        category: 'Dance',
        difficultyLevel: 'Beginner',
      },
      create: {
        className: 'Zumba',
        description: 'Dance fitness party',
        category: 'Dance',
        difficultyLevel: 'Beginner',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'Spinning' },
      update: {
        description: 'Indoor cycling workout',
        category: 'Cardio',
        difficultyLevel: 'Intermediate',
      },
      create: {
        className: 'Spinning',
        description: 'Indoor cycling workout',
        category: 'Cardio',
        difficultyLevel: 'Intermediate',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'Boxing' },
      update: {
        description: 'Cardio boxing and technique',
        category: 'Combat',
        difficultyLevel: 'Intermediate',
      },
      create: {
        className: 'Boxing',
        description: 'Cardio boxing and technique',
        category: 'Combat',
        difficultyLevel: 'Intermediate',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'CrossFit' },
      update: {
        description: 'Functional fitness workout',
        category: 'Functional',
        difficultyLevel: 'Advanced',
      },
      create: {
        className: 'CrossFit',
        description: 'Functional fitness workout',
        category: 'Functional',
        difficultyLevel: 'Advanced',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'Stretching & Mobility' },
      update: {
        description: 'Improve flexibility and recovery',
        category: 'Flexibility',
        difficultyLevel: 'Beginner',
      },
      create: {
        className: 'Stretching & Mobility',
        description: 'Improve flexibility and recovery',
        category: 'Flexibility',
        difficultyLevel: 'Beginner',
      },
    }),
    prisma.gymClass.upsert({
      where: { className: 'BodyPump' },
      update: {
        description: 'Barbell workout for full body',
        category: 'Strength',
        difficultyLevel: 'Intermediate',
      },
      create: {
        className: 'BodyPump',
        description: 'Barbell workout for full body',
        category: 'Strength',
        difficultyLevel: 'Intermediate',
      },
    }),
  ]);

  const [
    yogaBeginnerClass,
    yogaAdvancedClass,
    hiit30Class,
    hiit45Class,
    strengthTrainingClass,
    pilatesClass,
    zumbaClass,
    spinningClass,
    boxingClass,
    crossfitClass,
    stretchingClass,
    bodyPumpClass,
  ] = gymClasses;

  const workoutExercises = [
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

  const seededExercises = await Promise.all(
    workoutExercises.map((exercise) =>
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

  console.log(`✅ Created ${gymClasses.length} gym class templates`);
  console.log(`✅ Created ${seededExercises.length} workout exercises`);

  // Helper to create time from hours and minutes (for schedule times)
  const createTimeForSchedule = (hour: number, minute: number = 0): Date => {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date;
  };

  // Note: ClassSchedule creation now requires trainerId - we'll create schedules after users
  // Store gym class IDs for later schedule creation
  const gymClassIds = {
    yogaBeginner: yogaBeginnerClass.id,
    yogaAdvanced: yogaAdvancedClass.id,
    hiit30: hiit30Class.id,
    hiit45: hiit45Class.id,
    strengthTraining: strengthTrainingClass.id,
    pilates: pilatesClass.id,
    zumba: zumbaClass.id,
    spinning: spinningClass.id,
    boxing: boxingClass.id,
    crossfit: crossfitClass.id,
    stretching: stretchingClass.id,
    bodyPump: bodyPumpClass.id,
  };

  // 4) Users (admin + sample member + sample trainer)
  const adminPasswordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 10);
  const memberPasswordHash = await bcrypt.hash(SEED_MEMBER_PASSWORD, 10);
  const trainerPasswordHash = await bcrypt.hash(SEED_TRAINER_PASSWORD, 10);

  const adminUser = await prisma.user.upsert({
    where: { email: SEED_ADMIN_EMAIL },
    update: {
      firstName: SEED_ADMIN_FIRST_NAME,
      lastName: SEED_ADMIN_LAST_NAME,
      // NOTE: don't overwrite password unless explicitly requested
      ...(process.env.SEED_FORCE_UPDATE_PASSWORD === 'true'
        ? { password: adminPasswordHash }
        : {}),
      status: 'active',
    },
    create: {
      firstName: SEED_ADMIN_FIRST_NAME,
      lastName: SEED_ADMIN_LAST_NAME,
      email: SEED_ADMIN_EMAIL,
      password: adminPasswordHash,
      status: 'active',
    },
  });

  const memberUser = await prisma.user.upsert({
    where: { email: SEED_MEMBER_EMAIL },
    update: {
      firstName: 'Gym',
      lastName: 'Member',
      ...(process.env.SEED_FORCE_UPDATE_PASSWORD === 'true'
        ? { password: memberPasswordHash }
        : {}),
      status: 'active',
    },
    create: {
      firstName: 'Gym',
      lastName: 'Member',
      email: SEED_MEMBER_EMAIL,
      password: memberPasswordHash,
      status: 'active',
      gender: 'other',
      dob: new Date('1995-01-01'),
    },
  });

  const trainerUser = await prisma.user.upsert({
    where: { email: SEED_TRAINER_EMAIL },
    update: {
      firstName: 'John',
      lastName: 'Trainer',
      ...(process.env.SEED_FORCE_UPDATE_PASSWORD === 'true'
        ? { password: trainerPasswordHash }
        : {}),
      status: 'active',
    },
    create: {
      firstName: 'John',
      lastName: 'Trainer',
      email: SEED_TRAINER_EMAIL,
      password: trainerPasswordHash,
      status: 'active',
      gender: 'male',
      dob: new Date('1990-05-15'),
      phone: '+1234567890',
      trainerAvailableTime: [
        { day: 'Monday', startTime: '09:00', endTime: '12:00' },
        { day: 'Monday', startTime: '14:00', endTime: '18:00' },
        { day: 'Wednesday', startTime: '09:00', endTime: '12:00' },
        { day: 'Wednesday', startTime: '14:00', endTime: '18:00' },
        { day: 'Friday', startTime: '09:00', endTime: '12:00' },
        { day: 'Friday', startTime: '14:00', endTime: '18:00' },
      ],
      trainerAvailableDays: ['Monday', 'Wednesday', 'Friday'],
    },
  });

  // Additional trainers
  const defaultPasswordHash = await bcrypt.hash(SEED_USERS_PASSWORD, 10);

  const trainers = await Promise.all([
    prisma.user.upsert({
      where: { email: 'sarah.johnson@gym.local' },
      update: { status: 'active' },
      create: {
        firstName: 'Sarah',
        lastName: 'Johnson',
        email: 'sarah.johnson@gym.local',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1992-08-22'),
        phone: '+1234567891',
        trainerAvailableTime: [
          { day: 'Tuesday', startTime: '06:00', endTime: '14:00' },
          { day: 'Thursday', startTime: '06:00', endTime: '14:00' },
          { day: 'Saturday', startTime: '08:00', endTime: '16:00' },
        ],
        trainerAvailableDays: ['Tuesday', 'Thursday', 'Saturday'],
      },
    }),
    prisma.user.upsert({
      where: { email: 'mike.chen@gym.local' },
      update: { status: 'active' },
      create: {
        firstName: 'Mike',
        lastName: 'Chen',
        email: 'mike.chen@gym.local',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1988-03-10'),
        phone: '+1234567892',
        trainerAvailableTime: [
          { day: 'Monday', startTime: '06:00', endTime: '10:00' },
          { day: 'Wednesday', startTime: '06:00', endTime: '10:00' },
          { day: 'Friday', startTime: '06:00', endTime: '10:00' },
          { day: 'Saturday', startTime: '10:00', endTime: '18:00' },
        ],
        trainerAvailableDays: ['Monday', 'Wednesday', 'Friday', 'Saturday'],
      },
    }),
    prisma.user.upsert({
      where: { email: 'emma.williams@gym.local' },
      update: { status: 'active' },
      create: {
        firstName: 'Emma',
        lastName: 'Williams',
        email: 'emma.williams@gym.local',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1995-11-30'),
        phone: '+1234567893',
        trainerAvailableTime: [
          { day: 'Monday', startTime: '17:00', endTime: '21:00' },
          { day: 'Tuesday', startTime: '17:00', endTime: '21:00' },
          { day: 'Thursday', startTime: '17:00', endTime: '21:00' },
          { day: 'Sunday', startTime: '09:00', endTime: '13:00' },
        ],
        trainerAvailableDays: ['Monday', 'Tuesday', 'Thursday', 'Sunday'],
      },
    }),
    prisma.user.upsert({
      where: { email: 'david.martinez@gym.local' },
      update: { status: 'active' },
      create: {
        firstName: 'David',
        lastName: 'Martinez',
        email: 'david.martinez@gym.local',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1985-07-18'),
        phone: '+1234567894',
        trainerAvailableTime: [
          { day: 'Tuesday', startTime: '09:00', endTime: '17:00' },
          { day: 'Thursday', startTime: '09:00', endTime: '17:00' },
        ],
        trainerAvailableDays: ['Tuesday', 'Thursday'],
      },
    }),
    prisma.user.upsert({
      where: { email: 'lisa.anderson@gym.local' },
      update: { status: 'active' },
      create: {
        firstName: 'Lisa',
        lastName: 'Anderson',
        email: 'lisa.anderson@gym.local',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1993-02-14'),
        phone: '+1234567895',
        trainerAvailableTime: [
          { day: 'Monday', startTime: '12:00', endTime: '20:00' },
          { day: 'Wednesday', startTime: '12:00', endTime: '20:00' },
          { day: 'Friday', startTime: '12:00', endTime: '20:00' },
        ],
        trainerAvailableDays: ['Monday', 'Wednesday', 'Friday'],
      },
    }),
  ]);

  // Additional members
  const members = await Promise.all([
    prisma.user.upsert({
      where: { email: 'alex.brown@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Alex',
        lastName: 'Brown',
        email: 'alex.brown@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1998-06-20'),
        phone: '+1234567896',
      },
    }),
    prisma.user.upsert({
      where: { email: 'jessica.davis@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Jessica',
        lastName: 'Davis',
        email: 'jessica.davis@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1996-09-15'),
        phone: '+1234567897',
      },
    }),
    prisma.user.upsert({
      where: { email: 'ryan.wilson@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Ryan',
        lastName: 'Wilson',
        email: 'ryan.wilson@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1994-12-05'),
        phone: '+1234567898',
      },
    }),
    prisma.user.upsert({
      where: { email: 'sophia.moore@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Sophia',
        lastName: 'Moore',
        email: 'sophia.moore@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('2000-04-12'),
        phone: '+1234567899',
      },
    }),
    prisma.user.upsert({
      where: { email: 'kevin.taylor@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Kevin',
        lastName: 'Taylor',
        email: 'kevin.taylor@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1991-01-28'),
        phone: '+1234567800',
      },
    }),
    prisma.user.upsert({
      where: { email: 'olivia.thomas@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Olivia',
        lastName: 'Thomas',
        email: 'olivia.thomas@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1997-07-08'),
        phone: '+1234567801',
      },
    }),
    prisma.user.upsert({
      where: { email: 'james.jackson@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'James',
        lastName: 'Jackson',
        email: 'james.jackson@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1989-10-25'),
        phone: '+1234567802',
      },
    }),
    prisma.user.upsert({
      where: { email: 'emily.white@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Emily',
        lastName: 'White',
        email: 'emily.white@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1999-03-17'),
        phone: '+1234567803',
      },
    }),
    prisma.user.upsert({
      where: { email: 'daniel.harris@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Daniel',
        lastName: 'Harris',
        email: 'daniel.harris@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1993-11-11'),
        phone: '+1234567804',
      },
    }),
    prisma.user.upsert({
      where: { email: 'mia.martin@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Mia',
        lastName: 'Martin',
        email: 'mia.martin@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('2001-05-23'),
        phone: '+1234567805',
      },
    }),
    prisma.user.upsert({
      where: { email: 'chris.lee@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Chris',
        lastName: 'Lee',
        email: 'chris.lee@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1987-08-30'),
        phone: '+1234567806',
      },
    }),
    prisma.user.upsert({
      where: { email: 'ava.garcia@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Ava',
        lastName: 'Garcia',
        email: 'ava.garcia@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1995-12-19'),
        phone: '+1234567807',
      },
    }),
    prisma.user.upsert({
      where: { email: 'matthew.rodriguez@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Matthew',
        lastName: 'Rodriguez',
        email: 'matthew.rodriguez@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1992-02-07'),
        phone: '+1234567808',
      },
    }),
    prisma.user.upsert({
      where: { email: 'isabella.lopez@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Isabella',
        lastName: 'Lopez',
        email: 'isabella.lopez@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'female',
        dob: new Date('1998-09-03'),
        phone: '+1234567809',
      },
    }),
    prisma.user.upsert({
      where: { email: 'joshua.hill@example.com' },
      update: { status: 'active' },
      create: {
        firstName: 'Joshua',
        lastName: 'Hill',
        email: 'joshua.hill@example.com',
        password: defaultPasswordHash,
        status: 'active',
        gender: 'male',
        dob: new Date('1990-06-14'),
        phone: '+1234567810',
      },
    }),
  ]);

  // 5) User roles (idempotent via composite PK)
  await Promise.all([
    prisma.userRole.upsert({
      where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
      update: {},
      create: { userId: adminUser.id, roleId: adminRole.id },
    }),
    prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: memberUser.id, roleId: memberRole.id },
      },
      update: {},
      create: { userId: memberUser.id, roleId: memberRole.id },
    }),
    prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: trainerUser.id, roleId: trainerRole.id },
      },
      update: {},
      create: { userId: trainerUser.id, roleId: trainerRole.id },
    }),
    // Assign trainer role to all trainers
    ...trainers.map((trainer) =>
      prisma.userRole.upsert({
        where: {
          userId_roleId: { userId: trainer.id, roleId: trainerRole.id },
        },
        update: {},
        create: { userId: trainer.id, roleId: trainerRole.id },
      }),
    ),
    // Assign member role to all members
    ...members.map((member) =>
      prisma.userRole.upsert({
        where: { userId_roleId: { userId: member.id, roleId: memberRole.id } },
        update: {},
        create: { userId: member.id, roleId: memberRole.id },
      }),
    ),
  ]);

  // 6) User memberships (avoid duplicates; there is no unique constraint)
  // 5b) Trainer Availabilities (relational table — replaces legacy JSON fields)
  const allTrainerIds = [trainerUser.id, ...trainers.map((t) => t.id)];
  await prisma.trainerAvailability.deleteMany({
    where: { trainerId: { in: allTrainerIds } },
  });

  // Helper: create time for @db.Time fields (uses epoch date)
  const seedTime = (h: number, m: number = 0) => new Date(Date.UTC(1970, 0, 1, h, m, 0, 0));

  await prisma.trainerAvailability.createMany({
    data: [
      // John Trainer (trainerUser): Mon/Wed/Fri 09:00-12:00, 14:00-18:00
      { trainerId: trainerUser.id, dayOfWeek: 1, startTime: seedTime(9), endTime: seedTime(12) },
      { trainerId: trainerUser.id, dayOfWeek: 1, startTime: seedTime(14), endTime: seedTime(18) },
      { trainerId: trainerUser.id, dayOfWeek: 3, startTime: seedTime(9), endTime: seedTime(12) },
      { trainerId: trainerUser.id, dayOfWeek: 3, startTime: seedTime(14), endTime: seedTime(18) },
      { trainerId: trainerUser.id, dayOfWeek: 5, startTime: seedTime(9), endTime: seedTime(12) },
      { trainerId: trainerUser.id, dayOfWeek: 5, startTime: seedTime(14), endTime: seedTime(18) },
      // Sarah Johnson (trainers[0]): Tue/Thu 06:00-14:00, Sat 08:00-16:00
      { trainerId: trainers[0].id, dayOfWeek: 2, startTime: seedTime(6), endTime: seedTime(14) },
      { trainerId: trainers[0].id, dayOfWeek: 4, startTime: seedTime(6), endTime: seedTime(14) },
      { trainerId: trainers[0].id, dayOfWeek: 6, startTime: seedTime(8), endTime: seedTime(16) },
      // Mike Chen (trainers[1]): Mon/Wed/Fri 06:00-10:00, Sat 10:00-18:00
      { trainerId: trainers[1].id, dayOfWeek: 1, startTime: seedTime(6), endTime: seedTime(10) },
      { trainerId: trainers[1].id, dayOfWeek: 3, startTime: seedTime(6), endTime: seedTime(10) },
      { trainerId: trainers[1].id, dayOfWeek: 5, startTime: seedTime(6), endTime: seedTime(10) },
      { trainerId: trainers[1].id, dayOfWeek: 6, startTime: seedTime(10), endTime: seedTime(18) },
      // Emma Williams (trainers[2]): Mon/Tue/Thu 17:00-21:00, Sun 09:00-13:00
      { trainerId: trainers[2].id, dayOfWeek: 1, startTime: seedTime(17), endTime: seedTime(21) },
      { trainerId: trainers[2].id, dayOfWeek: 2, startTime: seedTime(17), endTime: seedTime(21) },
      { trainerId: trainers[2].id, dayOfWeek: 4, startTime: seedTime(17), endTime: seedTime(21) },
      { trainerId: trainers[2].id, dayOfWeek: 0, startTime: seedTime(9), endTime: seedTime(13) },
      // David Martinez (trainers[3]): Tue/Thu 09:00-17:00
      { trainerId: trainers[3].id, dayOfWeek: 2, startTime: seedTime(9), endTime: seedTime(17) },
      { trainerId: trainers[3].id, dayOfWeek: 4, startTime: seedTime(9), endTime: seedTime(17) },
      // Lisa Anderson (trainers[4]): Mon/Wed/Fri 12:00-20:00
      { trainerId: trainers[4].id, dayOfWeek: 1, startTime: seedTime(12), endTime: seedTime(20) },
      { trainerId: trainers[4].id, dayOfWeek: 3, startTime: seedTime(12), endTime: seedTime(20) },
      { trainerId: trainers[4].id, dayOfWeek: 5, startTime: seedTime(12), endTime: seedTime(20) },
    ],
  });

  console.log(`✅ Created trainer availability records for ${allTrainerIds.length} trainers`);

  // 6) User memberships continued
  await ensureUserMembership({
    prisma,
    userId: memberUser.id,
    membershipId: basicMembership.id,
    membershipName: basicMembership.name,
    membershipDescription: basicMembership.description ?? '',
    status: 'normal',
    startDate: now,
    endDate: in30Days,
    updatedByAdmin: false,
  });

  // optional: give admin a premium membership for demo/testing
  if (process.env.SEED_ADMIN_MEMBERSHIP === 'true') {
    await ensureUserMembership({
      prisma,
      userId: adminUser.id,
      membershipId: premiumMembership.id,
      membershipName: premiumMembership.name,
      membershipDescription: premiumMembership.description ?? '',
      status: 'normal',
      startDate: now,
      endDate: in30Days,
      updatedByAdmin: true,
    });
  }

  // Assign varied memberships to members
  const membershipAssignments = [
    { member: members[0], membership: premiumMembership, days: 60 },
    { member: members[1], membership: basicMembership, days: 30 },
    { member: members[2], membership: vipMembership, days: 90 },
    { member: members[3], membership: studentMembership, days: 30 },
    { member: members[4], membership: premiumMembership, days: 45 },
    { member: members[5], membership: basicMembership, days: 30 },
    { member: members[6], membership: vipMembership, days: 120 },
    { member: members[7], membership: studentMembership, days: 30 },
    { member: members[8], membership: premiumMembership, days: 30 },
    { member: members[9], membership: basicMembership, days: 30 },
    { member: members[10], membership: seniorMembership, days: 30 },
    { member: members[11], membership: premiumMembership, days: 60 },
    { member: members[12], membership: basicMembership, days: 30 },
    { member: members[13], membership: vipMembership, days: 90 },
    { member: members[14], membership: premiumMembership, days: 30 },
  ];

  await Promise.all(
    membershipAssignments.map(({ member, membership, days }) => {
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + days);
      return ensureUserMembership({
        prisma,
        userId: member.id,
        membershipId: membership.id,
        membershipName: membership.name,
        membershipDescription: membership.description ?? '',
        status: 'normal',
        startDate: now,
        endDate,
        updatedByAdmin: false,
      });
    }),
  );

  // Assign memberships to trainers (they get free memberships)
  await Promise.all(
    trainers.map((trainer) =>
      ensureUserMembership({
        prisma,
        userId: trainer.id,
        membershipId: premiumMembership.id,
        membershipName: premiumMembership.name,
        membershipDescription: premiumMembership.description ?? '',
        status: 'normal',
        startDate: now,
        endDate: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year
        updatedByAdmin: true,
      }),
    ),
  );

  // 7) Trainer Availabilities
  // Helper to convert day name to dayOfWeek number
  const dayNameToNumber = (day: string): number => {
    const days: Record<string, number> = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6,
    };
    return days[day] ?? 0;
  };

  // Helper to create time from hours and minutes
  const createTime = (hour: number, minute: number = 0): Date => {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date;
  };

  // Create trainer availabilities based on the trainer data
  const trainerAvailabilities = [
    // John Trainer (trainerUser) - Monday, Wednesday, Friday
    {
      trainerId: trainerUser.id,
      day: 'Monday',
      startTime: createTime(9, 0),
      endTime: createTime(12, 0),
    },
    {
      trainerId: trainerUser.id,
      day: 'Monday',
      startTime: createTime(14, 0),
      endTime: createTime(18, 0),
    },
    {
      trainerId: trainerUser.id,
      day: 'Wednesday',
      startTime: createTime(9, 0),
      endTime: createTime(12, 0),
    },
    {
      trainerId: trainerUser.id,
      day: 'Wednesday',
      startTime: createTime(14, 0),
      endTime: createTime(18, 0),
    },
    {
      trainerId: trainerUser.id,
      day: 'Friday',
      startTime: createTime(9, 0),
      endTime: createTime(12, 0),
    },
    {
      trainerId: trainerUser.id,
      day: 'Friday',
      startTime: createTime(14, 0),
      endTime: createTime(18, 0),
    },

    // Sarah Johnson - Tuesday, Thursday, Saturday
    {
      trainerId: trainers[0].id,
      day: 'Tuesday',
      startTime: createTime(6, 0),
      endTime: createTime(14, 0),
    },
    {
      trainerId: trainers[0].id,
      day: 'Thursday',
      startTime: createTime(6, 0),
      endTime: createTime(14, 0),
    },
    {
      trainerId: trainers[0].id,
      day: 'Saturday',
      startTime: createTime(8, 0),
      endTime: createTime(16, 0),
    },

    // Mike Chen - Monday, Wednesday, Friday, Saturday
    {
      trainerId: trainers[1].id,
      day: 'Monday',
      startTime: createTime(6, 0),
      endTime: createTime(10, 0),
    },
    {
      trainerId: trainers[1].id,
      day: 'Wednesday',
      startTime: createTime(6, 0),
      endTime: createTime(10, 0),
    },
    {
      trainerId: trainers[1].id,
      day: 'Friday',
      startTime: createTime(6, 0),
      endTime: createTime(10, 0),
    },
    {
      trainerId: trainers[1].id,
      day: 'Saturday',
      startTime: createTime(10, 0),
      endTime: createTime(18, 0),
    },

    // Emma Williams - Monday, Tuesday, Thursday, Sunday
    {
      trainerId: trainers[2].id,
      day: 'Monday',
      startTime: createTime(17, 0),
      endTime: createTime(21, 0),
    },
    {
      trainerId: trainers[2].id,
      day: 'Tuesday',
      startTime: createTime(17, 0),
      endTime: createTime(21, 0),
    },
    {
      trainerId: trainers[2].id,
      day: 'Thursday',
      startTime: createTime(17, 0),
      endTime: createTime(21, 0),
    },
    {
      trainerId: trainers[2].id,
      day: 'Sunday',
      startTime: createTime(9, 0),
      endTime: createTime(13, 0),
    },

    // David Martinez - Tuesday, Thursday
    {
      trainerId: trainers[3].id,
      day: 'Tuesday',
      startTime: createTime(9, 0),
      endTime: createTime(17, 0),
    },
    {
      trainerId: trainers[3].id,
      day: 'Thursday',
      startTime: createTime(9, 0),
      endTime: createTime(17, 0),
    },

    // Lisa Anderson - Monday, Wednesday, Friday
    {
      trainerId: trainers[4].id,
      day: 'Monday',
      startTime: createTime(12, 0),
      endTime: createTime(20, 0),
    },
    {
      trainerId: trainers[4].id,
      day: 'Wednesday',
      startTime: createTime(12, 0),
      endTime: createTime(20, 0),
    },
    {
      trainerId: trainers[4].id,
      day: 'Friday',
      startTime: createTime(12, 0),
      endTime: createTime(20, 0),
    },
  ];

  // Create all trainer availability records
  await Promise.all(
    trainerAvailabilities.map((availability) =>
      prisma.trainerAvailability.create({
        data: {
          trainerId: availability.trainerId,
          dayOfWeek: dayNameToNumber(availability.day),
          startTime: availability.startTime,
          endTime: availability.endTime,
          isAvailable: true,
        },
      }),
    ),
  );

  console.log(
    `✅ Created ${trainerAvailabilities.length} trainer availability records`,
  );

  // 7b) Create Class Schedules (now with required trainerId and DayOfWeek enum)
  // ClassSchedule uses DayOfWeek enum: MON, TUE, WED, THU, FRI, SAT, SUN
  const classSchedules = await Promise.all([
    // Yoga - Beginner: Tuesday 7:00-8:00 with Sarah Johnson
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.yogaBeginner,
        trainerId: trainers[0].id,
        dayOfWeek: 'TUE',
        startTime: createTimeForSchedule(7, 0),
        endTime: createTimeForSchedule(8, 0),
        location: 'Studio A',
        capacity: 20,
        price: 120000,
      },
    }),
    // Yoga - Advanced: Monday 17:00-18:30 with Emma Williams
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.yogaAdvanced,
        trainerId: trainers[2].id,
        dayOfWeek: 'MON',
        startTime: createTimeForSchedule(17, 0),
        endTime: createTimeForSchedule(18, 30),
        location: 'Studio A',
        capacity: 15,
        price: 120000,
      },
    }),
    // HIIT 30min: Monday 6:00-6:30 with Mike Chen
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.hiit30,
        trainerId: trainers[1].id,
        dayOfWeek: 'MON',
        startTime: createTimeForSchedule(6, 0),
        endTime: createTimeForSchedule(6, 30),
        location: 'Main Floor',
        capacity: 25,
        price: 120000,
      },
    }),
    // HIIT 45min: Wednesday 18:00-18:45 with Lisa Anderson
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.hiit45,
        trainerId: trainers[4].id,
        dayOfWeek: 'WED',
        startTime: createTimeForSchedule(18, 0),
        endTime: createTimeForSchedule(18, 45),
        location: 'Main Floor',
        capacity: 25,
        price: 120000,
      },
    }),
    // Strength Training: Tuesday 14:00-15:00 with David Martinez
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.strengthTraining,
        trainerId: trainers[3].id,
        dayOfWeek: 'TUE',
        startTime: createTimeForSchedule(14, 0),
        endTime: createTimeForSchedule(15, 0),
        location: 'Weight Room',
        capacity: 12,
        price: 120000,
      },
    }),
    // Pilates: Wednesday 10:00-11:00 with Lisa Anderson
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.pilates,
        trainerId: trainers[4].id,
        dayOfWeek: 'WED',
        startTime: createTimeForSchedule(10, 0),
        endTime: createTimeForSchedule(11, 0),
        location: 'Studio B',
        capacity: 15,
        price: 120000,
      },
    }),
    // Zumba: Tuesday 18:00-19:00 with Emma Williams
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.zumba,
        trainerId: trainers[2].id,
        dayOfWeek: 'TUE',
        startTime: createTimeForSchedule(18, 0),
        endTime: createTimeForSchedule(19, 0),
        location: 'Studio A',
        capacity: 30,
        price: 120000,
      },
    }),
    // Spinning: Monday 6:30-7:30 with Mike Chen
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.spinning,
        trainerId: trainers[1].id,
        dayOfWeek: 'MON',
        startTime: createTimeForSchedule(6, 30),
        endTime: createTimeForSchedule(7, 30),
        location: 'Spin Room',
        capacity: 20,
        price: 120000,
      },
    }),
    // Boxing: Monday 14:00-15:00 with John Trainer
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.boxing,
        trainerId: trainerUser.id,
        dayOfWeek: 'MON',
        startTime: createTimeForSchedule(14, 0),
        endTime: createTimeForSchedule(15, 0),
        location: 'Boxing Ring',
        capacity: 10,
        price: 120000,
      },
    }),
    // CrossFit: Saturday 18:00-19:00 with Mike Chen
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.crossfit,
        trainerId: trainers[1].id,
        dayOfWeek: 'SAT',
        startTime: createTimeForSchedule(18, 0),
        endTime: createTimeForSchedule(19, 0),
        location: 'CrossFit Zone',
        capacity: 15,
        price: 120000,
      },
    }),
    // Stretching: Friday 7:00-7:30 with John Trainer
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.stretching,
        trainerId: trainerUser.id,
        dayOfWeek: 'FRI',
        startTime: createTimeForSchedule(7, 0),
        endTime: createTimeForSchedule(7, 30),
        location: 'Studio B',
        capacity: 20,
        price: 120000,
      },
    }),
    // BodyPump: Monday 10:00-11:00 with John Trainer
    prisma.classSchedule.create({
      data: {
        classId: gymClassIds.bodyPump,
        trainerId: trainerUser.id,
        dayOfWeek: 'MON',
        startTime: createTimeForSchedule(10, 0),
        endTime: createTimeForSchedule(11, 0),
        location: 'Weight Room',
        capacity: 20,
        price: 120000,
      },
    }),
  ]);

  const [
    yogaBeginnerSchedule,
    yogaAdvancedSchedule,
    hiit30Schedule,
    hiit45Schedule,
    strengthTrainingSchedule,
    pilatesSchedule,
    zumbaSchedule,
    spinningSchedule,
    boxingSchedule,
    crossfitSchedule,
    stretchingSchedule,
    bodyPumpSchedule,
  ] = classSchedules;

  console.log(`✅ Created ${classSchedules.length} class schedules`);

  // 8) Class bookings - create diverse bookings
  const bookingStatuses = ['confirmed', 'pending', 'cancelled', 'completed'];

  // Helper function to get random date in the past/future
  const getDateOffset = (daysOffset: number): Date => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysOffset);
    return date;
  };

  // Create bookings for different scenarios
  const classBookings = [
    // Past completed bookings
    {
      userId: members[0].id,
      classScheduleId: yogaBeginnerSchedule.id,
      bookingStartDate: getDateOffset(-10),
      bookingEndDate: getDateOffset(-10),
      status: 'completed',
    },
    {
      userId: members[1].id,
      classScheduleId: hiit30Schedule.id,
      bookingStartDate: getDateOffset(-8),
      bookingEndDate: getDateOffset(-8),
      status: 'completed',
    },
    {
      userId: members[2].id,
      classScheduleId: strengthTrainingSchedule.id,
      bookingStartDate: getDateOffset(-5),
      bookingEndDate: getDateOffset(-5),
      status: 'completed',
    },

    // Recent bookings
    {
      userId: members[3].id,
      classScheduleId: pilatesSchedule.id,
      bookingStartDate: getDateOffset(-2),
      bookingEndDate: getDateOffset(-2),
      status: 'completed',
    },
    {
      userId: members[4].id,
      classScheduleId: zumbaSchedule.id,
      bookingStartDate: getDateOffset(-1),
      bookingEndDate: getDateOffset(-1),
      status: 'completed',
    },

    // Today's bookings
    {
      userId: memberUser.id,
      classScheduleId: yogaBeginnerSchedule.id,
      bookingStartDate: now,
      bookingEndDate: now,
      status: 'confirmed',
    },
    {
      userId: members[5].id,
      classScheduleId: spinningSchedule.id,
      bookingStartDate: now,
      bookingEndDate: now,
      status: 'confirmed',
    },
    {
      userId: members[6].id,
      classScheduleId: hiit45Schedule.id,
      bookingStartDate: now,
      bookingEndDate: now,
      status: 'confirmed',
    },

    // Upcoming bookings - tomorrow
    {
      userId: members[7].id,
      classScheduleId: boxingSchedule.id,
      bookingStartDate: getDateOffset(1),
      bookingEndDate: getDateOffset(1),
      status: 'confirmed',
    },
    {
      userId: members[8].id,
      classScheduleId: crossfitSchedule.id,
      bookingStartDate: getDateOffset(1),
      bookingEndDate: getDateOffset(1),
      status: 'confirmed',
    },
    {
      userId: members[9].id,
      classScheduleId: yogaAdvancedSchedule.id,
      bookingStartDate: getDateOffset(1),
      bookingEndDate: getDateOffset(1),
      status: 'pending',
    },

    // Upcoming bookings - next few days
    {
      userId: members[10].id,
      classScheduleId: stretchingSchedule.id,
      bookingStartDate: getDateOffset(2),
      bookingEndDate: getDateOffset(2),
      status: 'confirmed',
    },
    {
      userId: members[11].id,
      classScheduleId: bodyPumpSchedule.id,
      bookingStartDate: getDateOffset(3),
      bookingEndDate: getDateOffset(3),
      status: 'confirmed',
    },
    {
      userId: members[12].id,
      classScheduleId: yogaBeginnerSchedule.id,
      bookingStartDate: getDateOffset(4),
      bookingEndDate: getDateOffset(4),
      status: 'confirmed',
    },
    {
      userId: members[13].id,
      classScheduleId: hiit30Schedule.id,
      bookingStartDate: getDateOffset(5),
      bookingEndDate: getDateOffset(5),
      status: 'pending',
    },
    {
      userId: members[14].id,
      classScheduleId: strengthTrainingSchedule.id,
      bookingStartDate: getDateOffset(6),
      bookingEndDate: getDateOffset(6),
      status: 'confirmed',
    },

    // Week ahead bookings
    {
      userId: members[0].id,
      classScheduleId: pilatesSchedule.id,
      bookingStartDate: getDateOffset(7),
      bookingEndDate: getDateOffset(7),
      status: 'confirmed',
    },
    {
      userId: members[1].id,
      classScheduleId: zumbaSchedule.id,
      bookingStartDate: getDateOffset(8),
      bookingEndDate: getDateOffset(8),
      status: 'confirmed',
    },
    {
      userId: members[2].id,
      classScheduleId: spinningSchedule.id,
      bookingStartDate: getDateOffset(9),
      bookingEndDate: getDateOffset(9),
      status: 'confirmed',
    },
    {
      userId: members[3].id,
      classScheduleId: boxingSchedule.id,
      bookingStartDate: getDateOffset(10),
      bookingEndDate: getDateOffset(10),
      status: 'pending',
    },
    {
      userId: members[4].id,
      classScheduleId: crossfitSchedule.id,
      bookingStartDate: getDateOffset(11),
      bookingEndDate: getDateOffset(11),
      status: 'confirmed',
    },

    // Cancelled bookings (various dates)
    {
      userId: members[5].id,
      classScheduleId: yogaAdvancedSchedule.id,
      bookingStartDate: getDateOffset(-3),
      bookingEndDate: getDateOffset(-3),
      status: 'cancelled',
    },
    {
      userId: members[6].id,
      classScheduleId: hiit45Schedule.id,
      bookingStartDate: getDateOffset(3),
      bookingEndDate: getDateOffset(3),
      status: 'cancelled',
    },
    {
      userId: members[7].id,
      classScheduleId: stretchingSchedule.id,
      bookingStartDate: getDateOffset(5),
      bookingEndDate: getDateOffset(5),
      status: 'cancelled',
    },

    // Multiple bookings for same user (different classes)
    {
      userId: memberUser.id,
      classScheduleId: strengthTrainingSchedule.id,
      bookingStartDate: getDateOffset(2),
      bookingEndDate: getDateOffset(2),
      status: 'confirmed',
    },
    {
      userId: memberUser.id,
      classScheduleId: hiit30Schedule.id,
      bookingStartDate: getDateOffset(4),
      bookingEndDate: getDateOffset(4),
      status: 'confirmed',
    },
    {
      userId: memberUser.id,
      classScheduleId: pilatesSchedule.id,
      bookingStartDate: getDateOffset(6),
      bookingEndDate: getDateOffset(6),
      status: 'pending',
    },

    // Popular classes with multiple bookings
    {
      userId: members[8].id,
      classScheduleId: yogaBeginnerSchedule.id,
      bookingStartDate: getDateOffset(7),
      bookingEndDate: getDateOffset(7),
      status: 'confirmed',
    },
    {
      userId: members[9].id,
      classScheduleId: yogaBeginnerSchedule.id,
      bookingStartDate: getDateOffset(7),
      bookingEndDate: getDateOffset(7),
      status: 'confirmed',
    },
    {
      userId: members[10].id,
      classScheduleId: hiit30Schedule.id,
      bookingStartDate: getDateOffset(8),
      bookingEndDate: getDateOffset(8),
      status: 'confirmed',
    },
    {
      userId: members[11].id,
      classScheduleId: hiit30Schedule.id,
      bookingStartDate: getDateOffset(8),
      bookingEndDate: getDateOffset(8),
      status: 'confirmed',
    },

    // Advanced bookings (2-3 weeks ahead)
    {
      userId: members[12].id,
      classScheduleId: yogaAdvancedSchedule.id,
      bookingStartDate: getDateOffset(14),
      bookingEndDate: getDateOffset(14),
      status: 'confirmed',
    },
    {
      userId: members[13].id,
      classScheduleId: crossfitSchedule.id,
      bookingStartDate: getDateOffset(15),
      bookingEndDate: getDateOffset(15),
      status: 'confirmed',
    },
    {
      userId: members[14].id,
      classScheduleId: boxingSchedule.id,
      bookingStartDate: getDateOffset(18),
      bookingEndDate: getDateOffset(18),
      status: 'confirmed',
    },
    {
      userId: members[0].id,
      classScheduleId: bodyPumpSchedule.id,
      bookingStartDate: getDateOffset(20),
      bookingEndDate: getDateOffset(20),
      status: 'pending',
    },
    {
      userId: members[1].id,
      classScheduleId: spinningSchedule.id,
      bookingStartDate: getDateOffset(21),
      bookingEndDate: getDateOffset(21),
      status: 'confirmed',
    },

    // More diverse bookings
    {
      userId: members[2].id,
      classScheduleId: zumbaSchedule.id,
      bookingStartDate: getDateOffset(12),
      bookingEndDate: getDateOffset(12),
      status: 'confirmed',
    },
    {
      userId: members[3].id,
      classScheduleId: stretchingSchedule.id,
      bookingStartDate: getDateOffset(13),
      bookingEndDate: getDateOffset(13),
      status: 'confirmed',
    },
    {
      userId: members[4].id,
      classScheduleId: hiit45Schedule.id,
      bookingStartDate: getDateOffset(14),
      bookingEndDate: getDateOffset(14),
      status: 'pending',
    },
    {
      userId: members[5].id,
      classScheduleId: yogaBeginnerSchedule.id,
      bookingStartDate: getDateOffset(15),
      bookingEndDate: getDateOffset(15),
      status: 'confirmed',
    },
  ];

  await Promise.all(
    classBookings.map((booking) =>
      prisma.classBooking.create({
        data: booking,
      }),
    ),
  );

  console.log('✅ Seed completed');
  console.log(`- Roles: ADMIN/STAFF/TRAINER/MEMBER`);
  console.log(
    `- Memberships: ${basicMembership.name}, ${premiumMembership.name}, ${vipMembership.name}, ${studentMembership.name}, ${seniorMembership.name}, ${dayPassMembership.name}`,
  );
  console.log(`- Class Schedules: 12 different classes`);
  console.log(`- Trainer Availabilities: 24 availability slots`);
  console.log(`- Class Bookings: ${classBookings.length} bookings created`);
  console.log(`- Admin: ${adminUser.email}`);
  console.log(`- Trainers: ${trainerUser.email} + ${trainers.length} more`);
  console.log(`- Members: ${memberUser.email} + ${members.length} more`);
  console.log(`- Total users: ${1 + 1 + trainers.length + members.length + 1}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exitCode = 1;
});
