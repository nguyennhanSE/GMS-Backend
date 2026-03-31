import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ChatMessageRole,
  ChatMessageSource,
  ChatSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CHATBOT_INTENTS, CHATBOT_SESSION_TTL_MS } from './chatbot.constants';
import { ChatbotMemberDataFacade } from './chatbot-member-data.facade';
import { ChatbotService } from './chatbot.service';
import { CohereClient } from './cohere.client';
import { FaqCatalogService } from './faq-catalog.service';
import { IntentRouterService } from './intent-router.service';

describe('ChatbotService', () => {
  let service: ChatbotService;
  let prisma: jest.Mocked<any>;
  let faqCatalogService: jest.Mocked<any>;
  let intentRouter: jest.Mocked<any>;
  let cohereClient: jest.Mocked<any>;
  let chatbotMemberDataFacade: jest.Mocked<any>;

  beforeEach(async () => {
    prisma = {
      chatSession: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      chatMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    faqCatalogService = {
      getSupportedTopics: jest.fn().mockReturnValue(['Class schedules']),
      getAnswer: jest.fn(),
      getIntentCatalog: jest.fn().mockReturnValue({}),
    };

    intentRouter = {
      match: jest.fn(),
    };

    cohereClient = {
      classifyMessage: jest.fn(),
    };

    chatbotMemberDataFacade = {
      getScheduleAnswer: jest.fn(),
      getBookingsAnswer: jest.fn(),
      getMembershipAnswer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: PrismaService, useValue: prisma },
        { provide: FaqCatalogService, useValue: faqCatalogService },
        { provide: IntentRouterService, useValue: intentRouter },
        { provide: CohereClient, useValue: cohereClient },
        { provide: ChatbotMemberDataFacade, useValue: chatbotMemberDataFacade },
      ],
    }).compile();

    service = module.get(ChatbotService);
  });

  it('closes a stale open session and creates a new one', async () => {
    const staleSession = {
      id: 'session-stale',
      memberId: 'member-1',
      status: ChatSessionStatus.OPEN,
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - CHATBOT_SESSION_TTL_MS - 1000),
      closedAt: null,
      messages: [],
    };
    const newSession = {
      id: 'session-new',
      memberId: 'member-1',
      status: ChatSessionStatus.OPEN,
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
      messages: [
        {
          id: 'msg-system',
          role: ChatMessageRole.SYSTEM,
          source: ChatMessageSource.SYSTEM,
          content: 'Hello.',
          intentKey: null,
          metadata: null,
          createdAt: new Date(),
        },
      ],
    };

    const tx = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue(staleSession),
        update: jest.fn().mockResolvedValue({ ...staleSession, status: ChatSessionStatus.CLOSED }),
        create: jest.fn().mockResolvedValue(newSession),
      },
    };

    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    const result = await service.createOrGetSession('member-1');

    expect(tx.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-stale' },
      data: expect.objectContaining({
        status: ChatSessionStatus.CLOSED,
      }),
    });
    expect(tx.chatSession.create).toHaveBeenCalled();
    expect(result.sessionId).toBe('session-new');
  });

  it('rejects sending a message to a stale session and closes it', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 'session-1',
      memberId: 'member-1',
      status: ChatSessionStatus.OPEN,
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - CHATBOT_SESSION_TTL_MS - 1000),
      closedAt: null,
      messages: [],
    });
    prisma.chatSession.update.mockResolvedValue({
      id: 'session-1',
      status: ChatSessionStatus.CLOSED,
    });

    await expect(
      service.sendMessage('member-1', 'session-1', 'my bookings'),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        status: ChatSessionStatus.CLOSED,
      }),
    });
  });

  it('uses the rules-first path for direct membership questions', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 'session-1',
      memberId: 'member-1',
      status: ChatSessionStatus.OPEN,
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
      messages: [],
    });
    prisma.chatMessage.create.mockResolvedValue({});
    prisma.chatMessage.findMany.mockResolvedValue([]);
    prisma.chatSession.update.mockResolvedValue({});

    intentRouter.match.mockReturnValue({
      intentKey: CHATBOT_INTENTS.membershipActive,
    });
    chatbotMemberDataFacade.getMembershipAnswer.mockResolvedValue({
      text: 'Your active membership is Premium.',
      linkedActions: ['open_membership_page'],
      suggestedTopics: ['My membership'],
      handoffSuggested: false,
    });

    const result = await service.sendMessage(
      'member-1',
      'session-1',
      'What is my membership?',
    );

    expect(cohereClient.classifyMessage).not.toHaveBeenCalled();
    expect(chatbotMemberDataFacade.getMembershipAnswer).toHaveBeenCalledWith('member-1');
    expect(result).toMatchObject({
      sessionId: 'session-1',
      intentKey: CHATBOT_INTENTS.membershipActive,
      source: ChatMessageSource.RULE,
      linkedActions: ['open_membership_page'],
    });
  });
});
