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
const SEED_MEMBER_PASSWORD = process.env.SEED_MEMBER_PASSWORD || 'Member@123456';

const SEED_TRAINER_EMAIL = process.env.SEED_TRAINER_EMAIL || 'trainer@gym.local';
const SEED_TRAINER_PASSWORD = process.env.SEED_TRAINER_PASSWORD || 'Trainer@123456';

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
  const [basicMembership, premiumMembership, vipMembership, studentMembership, seniorMembership, dayPassMembership] = await Promise.all([
    prisma.membership.upsert({
      where: { name: 'Basic' },
      update: { description: 'Access to gym during staffed hours', minPrice: 199000 },
      create: { name: 'Basic', description: 'Access to gym during staffed hours', minPrice: 199000 },
    }),
    prisma.membership.upsert({
      where: { name: 'Premium' },
      update: { description: '24/7 access + group classes', minPrice: 399000 },
      create: { name: 'Premium', description: '24/7 access + group classes', minPrice: 399000 },
    }),
    prisma.membership.upsert({
      where: { name: 'VIP' },
      update: { description: '24/7 access + all classes + personal training sessions', minPrice: 799000 },
      create: { name: 'VIP', description: '24/7 access + all classes + personal training sessions', minPrice: 799000 },
    }),
    prisma.membership.upsert({
      where: { name: 'Student' },
      update: { description: 'Discounted membership for students with valid ID', minPrice: 149000 },
      create: { name: 'Student', description: 'Discounted membership for students with valid ID', minPrice: 149000 },
    }),
    prisma.membership.upsert({
      where: { name: 'Senior' },
      update: { description: 'Special rate for seniors 60+', minPrice: 129000 },
      create: { name: 'Senior', description: 'Special rate for seniors 60+', minPrice: 129000 },
    }),
    prisma.membership.upsert({
      where: { name: 'Day Pass' },
      update: { description: 'Single day access', minPrice: 50000 },
      create: { name: 'Day Pass', description: 'Single day access', minPrice: 50000 },
    }),
  ]);

  // 3) Class schedules with time slots (each 4 hours)
  // Helper to create time slots with current date and specific hours
  const createTimeSlot = (hour: number): { start: Date; end: Date } => {
    const start = new Date(now);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(now);
    end.setHours(hour + 4, 0, 0, 0);
    return { start, end };
  };

  const morningEarly = createTimeSlot(6);   // 6h-10h
  const morningLate = createTimeSlot(7);    // 7h-11h
  const afternoon = createTimeSlot(13);     // 13h-17h
  const evening = createTimeSlot(17);       // 17h-21h
  const midday = createTimeSlot(10);        // 10h-14h
  const lateEvening = createTimeSlot(18);   // 18h-22h

  const [
    yogaBeginner,
    yogaAdvanced,
    hiit30,
    hiit45,
    strengthTraining,
    pilates,
    zumba,
    spinning,
    boxing,
    crossfit,
    stretching,
    bodyPump,
  ] = await Promise.all([
    prisma.classSchedule.upsert({
      where: { name: 'Yoga - Beginner' },
      update: { 
        description: 'Beginner-friendly yoga flow',
        classStartTime: morningLate.start,
        classEndTime: morningLate.end,
      },
      create: { 
        name: 'Yoga - Beginner', 
        description: 'Beginner-friendly yoga flow',
        classStartTime: morningLate.start,
        classEndTime: morningLate.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'Yoga - Advanced' },
      update: { 
        description: 'Advanced yoga techniques and poses',
        classStartTime: evening.start,
        classEndTime: evening.end,
      },
      create: { 
        name: 'Yoga - Advanced', 
        description: 'Advanced yoga techniques and poses',
        classStartTime: evening.start,
        classEndTime: evening.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'HIIT - 30min' },
      update: { 
        description: 'High intensity interval training',
        classStartTime: morningEarly.start,
        classEndTime: morningEarly.end,
      },
      create: { 
        name: 'HIIT - 30min', 
        description: 'High intensity interval training',
        classStartTime: morningEarly.start,
        classEndTime: morningEarly.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'HIIT - 45min' },
      update: { 
        description: 'Extended high intensity interval training',
        classStartTime: lateEvening.start,
        classEndTime: lateEvening.end,
      },
      create: { 
        name: 'HIIT - 45min', 
        description: 'Extended high intensity interval training',
        classStartTime: lateEvening.start,
        classEndTime: lateEvening.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'Strength Training' },
      update: { 
        description: 'Full-body strength session',
        classStartTime: afternoon.start,
        classEndTime: afternoon.end,
      },
      create: { 
        name: 'Strength Training', 
        description: 'Full-body strength session',
        classStartTime: afternoon.start,
        classEndTime: afternoon.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'Pilates' },
      update: { 
        description: 'Core strengthening and flexibility',
        classStartTime: midday.start,
        classEndTime: midday.end,
      },
      create: { 
        name: 'Pilates', 
        description: 'Core strengthening and flexibility',
        classStartTime: midday.start,
        classEndTime: midday.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'Zumba' },
      update: { 
        description: 'Dance fitness party',
        classStartTime: evening.start,
        classEndTime: evening.end,
      },
      create: { 
        name: 'Zumba', 
        description: 'Dance fitness party',
        classStartTime: evening.start,
        classEndTime: evening.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'Spinning' },
      update: { 
        description: 'Indoor cycling workout',
        classStartTime: morningEarly.start,
        classEndTime: morningEarly.end,
      },
      create: { 
        name: 'Spinning', 
        description: 'Indoor cycling workout',
        classStartTime: morningEarly.start,
        classEndTime: morningEarly.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'Boxing' },
      update: { 
        description: 'Cardio boxing and technique',
        classStartTime: afternoon.start,
        classEndTime: afternoon.end,
      },
      create: { 
        name: 'Boxing', 
        description: 'Cardio boxing and technique',
        classStartTime: afternoon.start,
        classEndTime: afternoon.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'CrossFit' },
      update: { 
        description: 'Functional fitness workout',
        classStartTime: lateEvening.start,
        classEndTime: lateEvening.end,
      },
      create: { 
        name: 'CrossFit', 
        description: 'Functional fitness workout',
        classStartTime: lateEvening.start,
        classEndTime: lateEvening.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'Stretching & Mobility' },
      update: { 
        description: 'Improve flexibility and recovery',
        classStartTime: morningLate.start,
        classEndTime: morningLate.end,
      },
      create: { 
        name: 'Stretching & Mobility', 
        description: 'Improve flexibility and recovery',
        classStartTime: morningLate.start,
        classEndTime: morningLate.end,
      },
    }),
    prisma.classSchedule.upsert({
      where: { name: 'BodyPump' },
      update: { 
        description: 'Barbell workout for full body',
        classStartTime: midday.start,
        classEndTime: midday.end,
      },
      create: { 
        name: 'BodyPump', 
        description: 'Barbell workout for full body',
        classStartTime: midday.start,
        classEndTime: midday.end,
      },
    }),
  ]);

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
      ...(process.env.SEED_FORCE_UPDATE_PASSWORD === 'true' ? { password: adminPasswordHash } : {}),
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
      ...(process.env.SEED_FORCE_UPDATE_PASSWORD === 'true' ? { password: memberPasswordHash } : {}),
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
      ...(process.env.SEED_FORCE_UPDATE_PASSWORD === 'true' ? { password: trainerPasswordHash } : {}),
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
      where: { userId_roleId: { userId: memberUser.id, roleId: memberRole.id } },
      update: {},
      create: { userId: memberUser.id, roleId: memberRole.id },
    }),
    prisma.userRole.upsert({
      where: { userId_roleId: { userId: trainerUser.id, roleId: trainerRole.id } },
      update: {},
      create: { userId: trainerUser.id, roleId: trainerRole.id },
    }),
    // Assign trainer role to all trainers
    ...trainers.map((trainer) =>
      prisma.userRole.upsert({
        where: { userId_roleId: { userId: trainer.id, roleId: trainerRole.id } },
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

  // 7) Class bookings - create diverse bookings
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
      classScheduleId: yogaBeginner.id,
      bookingStartDate: getDateOffset(-10),
      bookingEndDate: getDateOffset(-10),
      status: 'completed',
    },
    {
      userId: members[1].id,
      classScheduleId: hiit30.id,
      bookingStartDate: getDateOffset(-8),
      bookingEndDate: getDateOffset(-8),
      status: 'completed',
    },
    {
      userId: members[2].id,
      classScheduleId: strengthTraining.id,
      bookingStartDate: getDateOffset(-5),
      bookingEndDate: getDateOffset(-5),
      status: 'completed',
    },
    
    // Recent bookings
    {
      userId: members[3].id,
      classScheduleId: pilates.id,
      bookingStartDate: getDateOffset(-2),
      bookingEndDate: getDateOffset(-2),
      status: 'completed',
    },
    {
      userId: members[4].id,
      classScheduleId: zumba.id,
      bookingStartDate: getDateOffset(-1),
      bookingEndDate: getDateOffset(-1),
      status: 'completed',
    },
    
    // Today's bookings
    {
      userId: memberUser.id,
      classScheduleId: yogaBeginner.id,
      bookingStartDate: now,
      bookingEndDate: now,
      status: 'confirmed',
    },
    {
      userId: members[5].id,
      classScheduleId: spinning.id,
      bookingStartDate: now,
      bookingEndDate: now,
      status: 'confirmed',
    },
    {
      userId: members[6].id,
      classScheduleId: hiit45.id,
      bookingStartDate: now,
      bookingEndDate: now,
      status: 'confirmed',
    },
    
    // Upcoming bookings - tomorrow
    {
      userId: members[7].id,
      classScheduleId: boxing.id,
      bookingStartDate: getDateOffset(1),
      bookingEndDate: getDateOffset(1),
      status: 'confirmed',
    },
    {
      userId: members[8].id,
      classScheduleId: crossfit.id,
      bookingStartDate: getDateOffset(1),
      bookingEndDate: getDateOffset(1),
      status: 'confirmed',
    },
    {
      userId: members[9].id,
      classScheduleId: yogaAdvanced.id,
      bookingStartDate: getDateOffset(1),
      bookingEndDate: getDateOffset(1),
      status: 'pending',
    },
    
    // Upcoming bookings - next few days
    {
      userId: members[10].id,
      classScheduleId: stretching.id,
      bookingStartDate: getDateOffset(2),
      bookingEndDate: getDateOffset(2),
      status: 'confirmed',
    },
    {
      userId: members[11].id,
      classScheduleId: bodyPump.id,
      bookingStartDate: getDateOffset(3),
      bookingEndDate: getDateOffset(3),
      status: 'confirmed',
    },
    {
      userId: members[12].id,
      classScheduleId: yogaBeginner.id,
      bookingStartDate: getDateOffset(4),
      bookingEndDate: getDateOffset(4),
      status: 'confirmed',
    },
    {
      userId: members[13].id,
      classScheduleId: hiit30.id,
      bookingStartDate: getDateOffset(5),
      bookingEndDate: getDateOffset(5),
      status: 'pending',
    },
    {
      userId: members[14].id,
      classScheduleId: strengthTraining.id,
      bookingStartDate: getDateOffset(6),
      bookingEndDate: getDateOffset(6),
      status: 'confirmed',
    },
    
    // Week ahead bookings
    {
      userId: members[0].id,
      classScheduleId: pilates.id,
      bookingStartDate: getDateOffset(7),
      bookingEndDate: getDateOffset(7),
      status: 'confirmed',
    },
    {
      userId: members[1].id,
      classScheduleId: zumba.id,
      bookingStartDate: getDateOffset(8),
      bookingEndDate: getDateOffset(8),
      status: 'confirmed',
    },
    {
      userId: members[2].id,
      classScheduleId: spinning.id,
      bookingStartDate: getDateOffset(9),
      bookingEndDate: getDateOffset(9),
      status: 'confirmed',
    },
    {
      userId: members[3].id,
      classScheduleId: boxing.id,
      bookingStartDate: getDateOffset(10),
      bookingEndDate: getDateOffset(10),
      status: 'pending',
    },
    {
      userId: members[4].id,
      classScheduleId: crossfit.id,
      bookingStartDate: getDateOffset(11),
      bookingEndDate: getDateOffset(11),
      status: 'confirmed',
    },
    
    // Cancelled bookings (various dates)
    {
      userId: members[5].id,
      classScheduleId: yogaAdvanced.id,
      bookingStartDate: getDateOffset(-3),
      bookingEndDate: getDateOffset(-3),
      status: 'cancelled',
    },
    {
      userId: members[6].id,
      classScheduleId: hiit45.id,
      bookingStartDate: getDateOffset(3),
      bookingEndDate: getDateOffset(3),
      status: 'cancelled',
    },
    {
      userId: members[7].id,
      classScheduleId: stretching.id,
      bookingStartDate: getDateOffset(5),
      bookingEndDate: getDateOffset(5),
      status: 'cancelled',
    },
    
    // Multiple bookings for same user (different classes)
    {
      userId: memberUser.id,
      classScheduleId: strengthTraining.id,
      bookingStartDate: getDateOffset(2),
      bookingEndDate: getDateOffset(2),
      status: 'confirmed',
    },
    {
      userId: memberUser.id,
      classScheduleId: hiit30.id,
      bookingStartDate: getDateOffset(4),
      bookingEndDate: getDateOffset(4),
      status: 'confirmed',
    },
    {
      userId: memberUser.id,
      classScheduleId: pilates.id,
      bookingStartDate: getDateOffset(6),
      bookingEndDate: getDateOffset(6),
      status: 'pending',
    },
    
    // Popular classes with multiple bookings
    {
      userId: members[8].id,
      classScheduleId: yogaBeginner.id,
      bookingStartDate: getDateOffset(7),
      bookingEndDate: getDateOffset(7),
      status: 'confirmed',
    },
    {
      userId: members[9].id,
      classScheduleId: yogaBeginner.id,
      bookingStartDate: getDateOffset(7),
      bookingEndDate: getDateOffset(7),
      status: 'confirmed',
    },
    {
      userId: members[10].id,
      classScheduleId: hiit30.id,
      bookingStartDate: getDateOffset(8),
      bookingEndDate: getDateOffset(8),
      status: 'confirmed',
    },
    {
      userId: members[11].id,
      classScheduleId: hiit30.id,
      bookingStartDate: getDateOffset(8),
      bookingEndDate: getDateOffset(8),
      status: 'confirmed',
    },
    
    // Advanced bookings (2-3 weeks ahead)
    {
      userId: members[12].id,
      classScheduleId: yogaAdvanced.id,
      bookingStartDate: getDateOffset(14),
      bookingEndDate: getDateOffset(14),
      status: 'confirmed',
    },
    {
      userId: members[13].id,
      classScheduleId: crossfit.id,
      bookingStartDate: getDateOffset(15),
      bookingEndDate: getDateOffset(15),
      status: 'confirmed',
    },
    {
      userId: members[14].id,
      classScheduleId: boxing.id,
      bookingStartDate: getDateOffset(18),
      bookingEndDate: getDateOffset(18),
      status: 'confirmed',
    },
    {
      userId: members[0].id,
      classScheduleId: bodyPump.id,
      bookingStartDate: getDateOffset(20),
      bookingEndDate: getDateOffset(20),
      status: 'pending',
    },
    {
      userId: members[1].id,
      classScheduleId: spinning.id,
      bookingStartDate: getDateOffset(21),
      bookingEndDate: getDateOffset(21),
      status: 'confirmed',
    },
    
    // More diverse bookings
    {
      userId: members[2].id,
      classScheduleId: zumba.id,
      bookingStartDate: getDateOffset(12),
      bookingEndDate: getDateOffset(12),
      status: 'confirmed',
    },
    {
      userId: members[3].id,
      classScheduleId: stretching.id,
      bookingStartDate: getDateOffset(13),
      bookingEndDate: getDateOffset(13),
      status: 'confirmed',
    },
    {
      userId: members[4].id,
      classScheduleId: hiit45.id,
      bookingStartDate: getDateOffset(14),
      bookingEndDate: getDateOffset(14),
      status: 'pending',
    },
    {
      userId: members[5].id,
      classScheduleId: yogaBeginner.id,
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
  console.log(`- Memberships: ${basicMembership.name}, ${premiumMembership.name}, ${vipMembership.name}, ${studentMembership.name}, ${seniorMembership.name}, ${dayPassMembership.name}`);
  console.log(`- Class Schedules: 12 different classes`);
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

