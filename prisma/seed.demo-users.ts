process.env.NODE_ENV = 'production';

import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

type RoleName = 'ADMIN' | 'MEMBER' | 'TRAINER';

type DemoUserDefinition = {
  role: RoleName;
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
  gender?: string;
  dob?: Date;
  phone?: string;
  trainerAvailableDays?: string[];
  trainerAvailableTime?: Array<{
    day: string;
    startTime: string;
    endTime: string;
  }>;
};

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

function shouldForcePasswordUpdate(): boolean {
  return process.env.SEED_FORCE_UPDATE_PASSWORD === 'true';
}

const demoAdminPassword =
  process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
const demoMemberPassword =
  process.env.SEED_MEMBER_PASSWORD || 'Member@123456';
const demoTrainerPassword =
  process.env.SEED_TRAINER_PASSWORD || 'Trainer@123456';
const demoUsersPassword =
  process.env.SEED_USERS_PASSWORD || 'Password@123456';

const demoUsers: DemoUserDefinition[] = [
  {
    role: 'ADMIN',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@gym.local',
    firstName: process.env.SEED_ADMIN_FIRST_NAME || 'System',
    lastName: process.env.SEED_ADMIN_LAST_NAME || 'Admin',
    password: demoAdminPassword,
  },
  {
    role: 'MEMBER',
    email: process.env.SEED_MEMBER_EMAIL || 'member@gym.local',
    firstName: 'Gym',
    lastName: 'Member',
    password: demoMemberPassword,
    gender: 'other',
    dob: new Date('1995-01-01'),
  },
  {
    role: 'TRAINER',
    email: process.env.SEED_TRAINER_EMAIL || 'trainer@gym.local',
    firstName: 'John',
    lastName: 'Trainer',
    password: demoTrainerPassword,
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
  {
    role: 'TRAINER',
    email: 'sarah.johnson@gym.local',
    firstName: 'Sarah',
    lastName: 'Johnson',
    password: demoUsersPassword,
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
  {
    role: 'TRAINER',
    email: 'mike.chen@gym.local',
    firstName: 'Mike',
    lastName: 'Chen',
    password: demoUsersPassword,
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
  {
    role: 'TRAINER',
    email: 'emma.williams@gym.local',
    firstName: 'Emma',
    lastName: 'Williams',
    password: demoUsersPassword,
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
  {
    role: 'TRAINER',
    email: 'david.martinez@gym.local',
    firstName: 'David',
    lastName: 'Martinez',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1985-07-18'),
    phone: '+1234567894',
    trainerAvailableTime: [
      { day: 'Tuesday', startTime: '09:00', endTime: '17:00' },
      { day: 'Thursday', startTime: '09:00', endTime: '17:00' },
    ],
    trainerAvailableDays: ['Tuesday', 'Thursday'],
  },
  {
    role: 'TRAINER',
    email: 'lisa.anderson@gym.local',
    firstName: 'Lisa',
    lastName: 'Anderson',
    password: demoUsersPassword,
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
  {
    role: 'MEMBER',
    email: 'alex.brown@example.com',
    firstName: 'Alex',
    lastName: 'Brown',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1998-06-20'),
    phone: '+1234567896',
  },
  {
    role: 'MEMBER',
    email: 'jessica.davis@example.com',
    firstName: 'Jessica',
    lastName: 'Davis',
    password: demoUsersPassword,
    gender: 'female',
    dob: new Date('1996-09-15'),
    phone: '+1234567897',
  },
  {
    role: 'MEMBER',
    email: 'ryan.wilson@example.com',
    firstName: 'Ryan',
    lastName: 'Wilson',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1994-12-05'),
    phone: '+1234567898',
  },
  {
    role: 'MEMBER',
    email: 'sophia.moore@example.com',
    firstName: 'Sophia',
    lastName: 'Moore',
    password: demoUsersPassword,
    gender: 'female',
    dob: new Date('2000-04-12'),
    phone: '+1234567899',
  },
  {
    role: 'MEMBER',
    email: 'kevin.taylor@example.com',
    firstName: 'Kevin',
    lastName: 'Taylor',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1991-01-28'),
    phone: '+1234567800',
  },
  {
    role: 'MEMBER',
    email: 'olivia.thomas@example.com',
    firstName: 'Olivia',
    lastName: 'Thomas',
    password: demoUsersPassword,
    gender: 'female',
    dob: new Date('1997-07-08'),
    phone: '+1234567801',
  },
  {
    role: 'MEMBER',
    email: 'james.jackson@example.com',
    firstName: 'James',
    lastName: 'Jackson',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1989-10-25'),
    phone: '+1234567802',
  },
  {
    role: 'MEMBER',
    email: 'emily.white@example.com',
    firstName: 'Emily',
    lastName: 'White',
    password: demoUsersPassword,
    gender: 'female',
    dob: new Date('1999-03-17'),
    phone: '+1234567803',
  },
  {
    role: 'MEMBER',
    email: 'daniel.harris@example.com',
    firstName: 'Daniel',
    lastName: 'Harris',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1993-11-11'),
    phone: '+1234567804',
  },
  {
    role: 'MEMBER',
    email: 'mia.martin@example.com',
    firstName: 'Mia',
    lastName: 'Martin',
    password: demoUsersPassword,
    gender: 'female',
    dob: new Date('2001-05-23'),
    phone: '+1234567805',
  },
  {
    role: 'MEMBER',
    email: 'chris.lee@example.com',
    firstName: 'Chris',
    lastName: 'Lee',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1987-08-30'),
    phone: '+1234567806',
  },
  {
    role: 'MEMBER',
    email: 'ava.garcia@example.com',
    firstName: 'Ava',
    lastName: 'Garcia',
    password: demoUsersPassword,
    gender: 'female',
    dob: new Date('1995-12-19'),
    phone: '+1234567807',
  },
  {
    role: 'MEMBER',
    email: 'matthew.rodriguez@example.com',
    firstName: 'Matthew',
    lastName: 'Rodriguez',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1992-02-07'),
    phone: '+1234567808',
  },
  {
    role: 'MEMBER',
    email: 'isabella.lopez@example.com',
    firstName: 'Isabella',
    lastName: 'Lopez',
    password: demoUsersPassword,
    gender: 'female',
    dob: new Date('1998-09-03'),
    phone: '+1234567809',
  },
  {
    role: 'MEMBER',
    email: 'joshua.hill@example.com',
    firstName: 'Joshua',
    lastName: 'Hill',
    password: demoUsersPassword,
    gender: 'male',
    dob: new Date('1990-06-14'),
    phone: '+1234567810',
  },
];

async function ensureRoles(prisma: PrismaClient) {
  const roles = await Promise.all([
    prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: { description: 'System administrator' },
      create: { name: 'ADMIN', description: 'System administrator' },
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

  return {
    ADMIN: roles[0].id,
    TRAINER: roles[1].id,
    MEMBER: roles[2].id,
  } as const;
}

async function upsertDemoUser(prisma: PrismaClient, user: DemoUserDefinition) {
  const passwordHash = await bcrypt.hash(user.password ?? demoUsersPassword, 10);
  const forcePasswordUpdate = shouldForcePasswordUpdate();

  return prisma.user.upsert({
    where: { email: user.email },
    update: {
      firstName: user.firstName,
      lastName: user.lastName,
      gender: user.gender,
      dob: user.dob,
      phone: user.phone,
      trainerAvailableDays: user.trainerAvailableDays,
      trainerAvailableTime: user.trainerAvailableTime,
      ...(forcePasswordUpdate ? { password: passwordHash } : {}),
      status: 'active',
    },
    create: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password: passwordHash,
      status: 'active',
      gender: user.gender,
      dob: user.dob,
      phone: user.phone,
      trainerAvailableDays: user.trainerAvailableDays,
      trainerAvailableTime: user.trainerAvailableTime,
    },
  });
}

async function main() {
  loadProductionEnv();
  const databaseUrl = assertEnv('DATABASE_URL');

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const roleIds = await ensureRoles(prisma);
    const users = await Promise.all(
      demoUsers.map((user) => upsertDemoUser(prisma, user)),
    );

    await Promise.all(
      users.map((user, index) =>
        prisma.userRole.upsert({
          where: {
            userId_roleId: {
              userId: user.id,
              roleId: roleIds[demoUsers[index].role],
            },
          },
          update: {},
          create: {
            userId: user.id,
            roleId: roleIds[demoUsers[index].role],
          },
        }),
      ),
    );

    const trainerCount = demoUsers.filter((user) => user.role === 'TRAINER').length;
    const memberCount = demoUsers.filter((user) => user.role === 'MEMBER').length;
    const adminCount = demoUsers.filter((user) => user.role === 'ADMIN').length;

    console.log('✅ Production demo-user seed completed');
    console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`- Admin users: ${adminCount}`);
    console.log(`- Trainer users: ${trainerCount}`);
    console.log(`- Member users: ${memberCount}`);
    console.log(`- Total demo users upserted: ${demoUsers.length}`);
    console.log('- Roles and user-role links were ensured');
    console.log(
      '- No memberships, trainerAvailability rows, schedules, bookings, or payments were modified',
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Production demo-user seed failed:', error);
  process.exitCode = 1;
});
