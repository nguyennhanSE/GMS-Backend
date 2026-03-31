import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { CohereClient } from '../src/modules/chatbot/cohere.client';
import {
  TestData,
  authRequest,
  cleanupTestData,
  createTestData,
  loginAs,
} from './test-helpers';

describe('Chatbot (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let testData: TestData;
  let memberToken: string;
  let adminToken: string;

  const mockCohereClient = {
    classifyMessage: jest.fn().mockResolvedValue(null),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CohereClient)
      .useValue(mockCohereClient)
      .compile();

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

    await cleanupChatbotData(prisma);
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);

    memberToken = await loginAs(
      app,
      testData.memberUser.email,
      testData.memberPassword,
    );
    adminToken = await loginAs(
      app,
      testData.adminUser.email,
      testData.adminPassword,
    );
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      await cleanupChatbotData(prisma);
      await cleanupTestData(prisma);
    }
    if (app) await app.close();
  });

  afterEach(async () => {
    await cleanupChatbotData(prisma);
    mockCohereClient.classifyMessage.mockClear();
  });

  async function cleanupChatbotData(p: PrismaService) {
    const testEmails = [
      'api-test-member@test.local',
      'api-test-admin@test.local',
      'api-test-trainer@test.local',
    ];

    await p.chatMessage.deleteMany({
      where: {
        session: {
          member: { email: { in: testEmails } },
        },
      },
    });

    await p.chatSession.deleteMany({
      where: {
        member: { email: { in: testEmails } },
      },
    });

    await p.userMembership.deleteMany({
      where: {
        user: { email: { in: testEmails } },
      },
    });

    await p.membership.deleteMany({
      where: {
        name: { startsWith: 'API Chatbot Membership' },
      },
    });
  }

  it('creates a member chatbot session with a greeting', async () => {
    const response = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data.sessionId).toBeDefined();
    expect(response.body.data.greetingMessage).toContain('Hello');
    expect(response.body.data.messages).toHaveLength(1);

    const dbSession = await prisma.chatSession.findUnique({
      where: { id: response.body.data.sessionId },
    });
    expect(dbSession).not.toBeNull();
    expect(dbSession!.memberId).toBe(testData.memberUser.id);
    expect(dbSession!.status).toBe('OPEN');
  });

  it('replaces a stale open session with a fresh one', async () => {
    const first = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    expect(first.status).toBe(201);

    await prisma.chatSession.update({
      where: { id: first.body.data.sessionId },
      data: {
        updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    const second = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    expect(second.status).toBe(201);
    expect(second.body.data.sessionId).not.toBe(first.body.data.sessionId);

    const staleSession = await prisma.chatSession.findUnique({
      where: { id: first.body.data.sessionId },
    });
    expect(staleSession!.status).toBe('CLOSED');
    expect(staleSession!.closedAt).not.toBeNull();
  });

  it('keeps exactly one open session when the member opens chat concurrently', async () => {
    const concurrentRequests = Array.from({ length: 8 }, () =>
      authRequest(app, memberToken).post('/chatbot/session').send({}),
    );

    const responses = await Promise.all(concurrentRequests);

    responses.forEach((response) => {
      expect(response.status).toBe(201);
      expect(response.body.data.sessionId).toBeDefined();
    });

    const returnedSessionIds = new Set(
      responses.map((response) => response.body.data.sessionId as string),
    );

    expect(returnedSessionIds.size).toBe(1);

    const openSessions = await prisma.chatSession.findMany({
      where: {
        memberId: testData.memberUser.id,
        status: 'OPEN',
      },
    });

    expect(openSessions).toHaveLength(1);
    expect(openSessions[0].id).toBe([...returnedSessionIds][0]);
  });

  it('returns the active session with full message history', async () => {
    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: 'my bookings' })
      .expect(201);

    const response = await authRequest(app, memberToken)
      .get('/chatbot/session/active');

    expect(response.status).toBe(200);
    expect(response.body.data.sessionId).toBe(session.body.data.sessionId);
    expect(response.body.data.status).toBe('OPEN');
    expect(response.body.data.messages).toHaveLength(3);
    expect(response.body.data.messages[0].role).toBe('SYSTEM');
    expect(response.body.data.messages[1].role).toBe('USER');
    expect(response.body.data.messages[2].role).toBe('ASSISTANT');
  });

  it('returns the full message list for a specific member session', async () => {
    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    const reply = await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: 'my membership' });

    expect(reply.status).toBe(201);

    const response = await authRequest(app, memberToken)
      .get(`/chatbot/session/${session.body.data.sessionId}/messages`);

    expect(response.status).toBe(200);
    expect(response.body.data.sessionId).toBe(session.body.data.sessionId);
    expect(response.body.data.status).toBe('OPEN');
    expect(response.body.data.messages).toHaveLength(3);
    expect(response.body.data.messages[2].intentKey).toBe(
      'membership.my_active',
    );
  });

  it('returns a schedule answer from the rules-first path', async () => {
    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    const response = await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: 'Schedule for API Integration Test' });

    expect(response.status).toBe(201);
    expect(response.body.data.intentKey).toBe('schedule.class_lookup');
    expect(response.body.data.source).toBe('RULE');
    expect(response.body.data.assistantMessage).toContain('API Integration Test Class');
    expect(mockCohereClient.classifyMessage).not.toHaveBeenCalled();
  });

  it('returns the no-bookings response for member booking queries', async () => {
    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    const response = await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: 'my bookings' });

    expect(response.status).toBe(201);
    expect(response.body.data.intentKey).toBe('booking.my_upcoming');
    expect(response.body.data.assistantMessage).toContain(
      'You do not have any bookings yet.',
    );
  });

  it('returns active membership details for membership queries', async () => {
    const membership = await prisma.membership.create({
      data: {
        name: 'API Chatbot Membership Premium',
        description: 'Membership for chatbot integration tests',
        minPrice: 100,
        purchasePrice: 100,
        level: 'PREMIUM',
      },
    });

    await prisma.userMembership.create({
      data: {
        userId: testData.memberUser.id,
        membershipId: membership.id,
        membershipName: membership.name,
        membershipDescription: membership.description ?? '',
        status: 'normal',
        level: 'PREMIUM',
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    const response = await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: 'my membership' });

    expect(response.status).toBe(201);
    expect(response.body.data.intentKey).toBe('membership.my_active');
    expect(response.body.data.assistantMessage).toContain(
      'API Chatbot Membership Premium',
    );
  });

  it('calls Cohere and returns the local fallback when no intent is resolved', async () => {
    mockCohereClient.classifyMessage.mockResolvedValueOnce(null);

    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    const response = await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: 'blorpo quantum pineapple' });

    expect(response.status).toBe(201);
    expect(mockCohereClient.classifyMessage).toHaveBeenCalledTimes(1);
    expect(response.body.data.intentKey).toBe('unsupported.transactional');
    expect(response.body.data.source).toBe('FALLBACK');
    expect(response.body.data.assistantMessage).toContain(
      'I did not understand that request.',
    );
  });

  it('bounces transactional prompts without changing booking state', async () => {
    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    const beforeCount = await prisma.classBooking.count({
      where: { userId: testData.memberUser.id },
    });

    const response = await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: 'Cancel my booking' });

    const afterCount = await prisma.classBooking.count({
      where: { userId: testData.memberUser.id },
    });

    expect(response.status).toBe(201);
    expect(response.body.data.intentKey).toBe('unsupported.transactional');
    expect(response.body.data.source).toBe('FALLBACK');
    expect(response.body.data.assistantMessage).toContain(
      'I cannot perform bookings, cancellations, or purchases in chat.',
    );
    expect(afterCount).toBe(beforeCount);
    expect(mockCohereClient.classifyMessage).not.toHaveBeenCalled();
  });

  it('rejects non-member access to the chatbot routes', async () => {
    const response = await authRequest(app, adminToken)
      .post('/chatbot/session')
      .send({});

    expect(response.status).toBe(403);
  });

  it('rejects invalid chatbot message payloads', async () => {
    const session = await authRequest(app, memberToken)
      .post('/chatbot/session')
      .send({});

    const response = await authRequest(app, memberToken)
      .post(`/chatbot/session/${session.body.data.sessionId}/messages`)
      .send({ message: '' });

    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated chatbot access', async () => {
    const response = await supertest
      .default(app.getHttpServer())
      .post('/chatbot/session')
      .send({});

    expect(response.status).toBe(401);
  });
});
