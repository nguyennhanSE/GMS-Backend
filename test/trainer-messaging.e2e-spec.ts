import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TrainerBookingStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { authRequest, loginAs } from './test-helpers';

type TestUser = {
  id: string;
  email: string;
  password: string;
};

describe('Trainer Messaging (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let memberUser: TestUser;
  let trainerUser: TestUser;
  let otherMemberUser: TestUser;

  let memberToken: string;
  let trainerToken: string;
  let otherMemberToken: string;

  const suiteKey = `trainer-messaging-e2e-${Date.now()}`;
  const userEmails = {
    member: `${suiteKey}-member@test.local`,
    trainer: `${suiteKey}-trainer@test.local`,
    otherMember: `${suiteKey}-other-member@test.local`,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    await cleanupSuiteState();
    await setupUsers();

    memberToken = await loginAs(app, memberUser.email, memberUser.password);
    trainerToken = await loginAs(app, trainerUser.email, trainerUser.password);
    otherMemberToken = await loginAs(
      app,
      otherMemberUser.email,
      otherMemberUser.password,
    );
  }, 60000);

  afterEach(async () => {
    await prisma.trainerConversationMessage.deleteMany({
      where: {
        conversation: {
          OR: [
            { memberId: memberUser.id },
            { trainerId: trainerUser.id },
            { memberId: otherMemberUser.id },
          ],
        },
      },
    });
    await prisma.trainerConversation.deleteMany({
      where: {
        OR: [
          { memberId: memberUser.id },
          { trainerId: trainerUser.id },
          { memberId: otherMemberUser.id },
        ],
      },
    });
    await prisma.trainerBooking.deleteMany({
      where: {
        OR: [
          { memberId: memberUser.id },
          { trainerId: trainerUser.id },
          { memberId: otherMemberUser.id },
        ],
      },
    });
  });

  afterAll(async () => {
    await cleanupSuiteState();
    if (app) {
      await app.close();
    }
  });

  it('lets an eligible member and trainer create a conversation, exchange messages, and manage unread state', async () => {
    await createTrainerBookingRecord({
      memberId: memberUser.id,
      trainerId: trainerUser.id,
      status: TrainerBookingStatus.CONFIRMED,
      startAt: new Date('2030-01-03T09:00:00.000Z'),
      endAt: new Date('2030-01-03T10:00:00.000Z'),
    });

    const createConversation = await authRequest(app, memberToken)
      .post('/trainer-messaging/conversations')
      .send({ partnerId: trainerUser.id });

    expect(createConversation.status).toBe(201);
    const conversationId = createConversation.body.data.id ?? createConversation.body.data.conversationId;
    expect(conversationId).toBeTruthy();

    const sendMessage = await authRequest(app, memberToken)
      .post(`/trainer-messaging/conversations/${conversationId}/messages`)
      .send({ content: '  Hello coach  ' });

    expect(sendMessage.status).toBe(201);
    expect(sendMessage.body.data.messages).toHaveLength(1);
    expect(sendMessage.body.data.messages[0].content).toBe('Hello coach');

    const trainerInbox = await authRequest(app, trainerToken)
      .get('/trainer-messaging/conversations')
      .send();

    expect(trainerInbox.status).toBe(200);
    expect(trainerInbox.body.data).toHaveLength(1);
    expect(trainerInbox.body.data[0].unreadCount).toBe(1);
    expect(trainerInbox.body.data[0].partner.id).toBe(memberUser.id);

    const trainerRead = await authRequest(app, trainerToken)
      .post(`/trainer-messaging/conversations/${conversationId}/read`)
      .send();
    expect(trainerRead.status).toBe(201);

    const trainerReply = await authRequest(app, trainerToken)
      .post(`/trainer-messaging/conversations/${conversationId}/messages`)
      .send({ content: 'See you then' });

    expect(trainerReply.status).toBe(201);
    expect(trainerReply.body.data.messages).toHaveLength(2);

    const memberInbox = await authRequest(app, memberToken)
      .get('/trainer-messaging/conversations')
      .send();

    expect(memberInbox.status).toBe(200);
    expect(memberInbox.body.data[0].unreadCount).toBe(1);

    const contacts = await authRequest(app, memberToken)
      .get('/trainer-messaging/contacts')
      .send();

    expect(contacts.status).toBe(200);
    expect(contacts.body.data[0].conversationId).toBe(conversationId);
  });

  it('rejects conversation creation for a pre-payment booking state', async () => {
    await createTrainerBookingRecord({
      memberId: memberUser.id,
      trainerId: trainerUser.id,
      status: TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
      startAt: new Date('2030-01-04T09:00:00.000Z'),
      endAt: new Date('2030-01-04T10:00:00.000Z'),
    });

    const response = await authRequest(app, memberToken)
      .post('/trainer-messaging/conversations')
      .send({ partnerId: trainerUser.id });

    expect(response.status).toBe(403);
  });

  it('hides and blocks a conversation once the supporting booking history becomes ineligible', async () => {
    const booking = await createTrainerBookingRecord({
      memberId: memberUser.id,
      trainerId: trainerUser.id,
      status: TrainerBookingStatus.CONFIRMED,
      startAt: new Date('2030-01-05T09:00:00.000Z'),
      endAt: new Date('2030-01-05T10:00:00.000Z'),
    });

    const createConversation = await authRequest(app, memberToken)
      .post('/trainer-messaging/conversations')
      .send({ partnerId: trainerUser.id });
    const conversationId = createConversation.body.data.id ?? createConversation.body.data.conversationId;

    await authRequest(app, memberToken)
      .post(`/trainer-messaging/conversations/${conversationId}/messages`)
      .send({ content: 'Keep this thread hidden later' })
      .expect(201);

    await prisma.trainerBooking.update({
      where: { id: booking.id },
      data: {
        status: TrainerBookingStatus.CANCELLED,
        cancelledAt: new Date('2030-01-04T00:00:00.000Z'),
      },
    });

    const inbox = await authRequest(app, memberToken)
      .get('/trainer-messaging/conversations')
      .send();
    expect(inbox.status).toBe(200);
    expect(inbox.body.data).toEqual([]);

    const messages = await authRequest(app, memberToken)
      .get(`/trainer-messaging/conversations/${conversationId}/messages`)
      .send();
    expect(messages.status).toBe(403);

    const sendAfterIneligible = await authRequest(app, memberToken)
      .post(`/trainer-messaging/conversations/${conversationId}/messages`)
      .send({ content: 'This should be blocked' });
    expect(sendAfterIneligible.status).toBe(403);
  });

  it('rejects access from a third party outside the eligible pair', async () => {
    await createTrainerBookingRecord({
      memberId: memberUser.id,
      trainerId: trainerUser.id,
      status: TrainerBookingStatus.CONFIRMED,
      startAt: new Date('2030-01-06T09:00:00.000Z'),
      endAt: new Date('2030-01-06T10:00:00.000Z'),
    });

    const createConversation = await authRequest(app, memberToken)
      .post('/trainer-messaging/conversations')
      .send({ partnerId: trainerUser.id });
    const conversationId = createConversation.body.data.id ?? createConversation.body.data.conversationId;

    const response = await authRequest(app, otherMemberToken)
      .get(`/trainer-messaging/conversations/${conversationId}/messages`)
      .send();

    expect(response.status).toBe(403);
  });

  async function setupUsers() {
    const password = 'Test@12345';
    const hashedPassword = await bcrypt.hash(password, 10);
    const roles = await ensureRoles();

    memberUser = await createUser({
      email: userEmails.member,
      firstName: 'Messaging',
      lastName: 'Member',
      hashedPassword,
      roleId: roles.member.id,
    });

    trainerUser = await createUser({
      email: userEmails.trainer,
      firstName: 'Messaging',
      lastName: 'Trainer',
      hashedPassword,
      roleId: roles.trainer.id,
    });

    otherMemberUser = await createUser({
      email: userEmails.otherMember,
      firstName: 'Messaging',
      lastName: 'Other',
      hashedPassword,
      roleId: roles.member.id,
    });
  }

  async function ensureRoles() {
    const member = await prisma.role.upsert({
      where: { name: 'MEMBER' },
      update: {},
      create: { name: 'MEMBER', description: 'Member role' },
    });
    const trainer = await prisma.role.upsert({
      where: { name: 'TRAINER' },
      update: {},
      create: { name: 'TRAINER', description: 'Trainer role' },
    });

    return { member, trainer };
  }

  async function createUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    hashedPassword: string;
    roleId: string;
  }): Promise<TestUser> {
    const user = await prisma.user.create({
      data: {
        firstName: params.firstName,
        lastName: params.lastName,
        email: params.email,
        password: params.hashedPassword,
        status: 'active',
        userRole: {
          create: { roleId: params.roleId },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      password: 'Test@12345',
    };
  }

  async function createTrainerBookingRecord(params: {
    memberId: string;
    trainerId: string;
    status: TrainerBookingStatus;
    startAt: Date;
    endAt: Date;
  }) {
    return prisma.trainerBooking.create({
      data: {
        memberId: params.memberId,
        trainerId: params.trainerId,
        status: params.status,
        startAt: params.startAt,
        endAt: params.endAt,
        price: 250000,
        currency: 'VND',
      },
    });
  }

  async function cleanupSuiteState() {
    await prisma.trainerConversationMessage.deleteMany({
      where: {
        OR: [
          { sender: { email: { in: Object.values(userEmails) } } },
          {
            conversation: {
              OR: [
                { member: { email: { in: Object.values(userEmails) } } },
                { trainer: { email: { in: Object.values(userEmails) } } },
              ],
            },
          },
        ],
      },
    });
    await prisma.trainerConversation.deleteMany({
      where: {
        OR: [
          { member: { email: { in: Object.values(userEmails) } } },
          { trainer: { email: { in: Object.values(userEmails) } } },
        ],
      },
    });
    await prisma.trainerBooking.deleteMany({
      where: {
        OR: [
          { member: { email: { in: Object.values(userEmails) } } },
          { trainer: { email: { in: Object.values(userEmails) } } },
        ],
      },
    });
    await prisma.session.deleteMany({
      where: { user: { email: { in: Object.values(userEmails) } } },
    });
    await prisma.userRole.deleteMany({
      where: { user: { email: { in: Object.values(userEmails) } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: Object.values(userEmails) } },
    });
  }
});
