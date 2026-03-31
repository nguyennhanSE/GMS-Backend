import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatMessageRole,
  ChatMessageSource,
  ChatSessionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CHATBOT_INTENTS,
  CHATBOT_LINKED_ACTIONS,
  CHATBOT_SESSION_TTL_MS,
} from './chatbot.constants';
import { FaqCatalogService } from './faq-catalog.service';
import {
  IntentMatch,
  IntentRouterService,
} from './intent-router.service';
import { CohereClient } from './cohere.client';
import { ChatbotMemberDataFacade } from './chatbot-member-data.facade';

interface ChatSessionWithMessages {
  id: string;
  memberId: string;
  status: ChatSessionStatus;
  updatedAt: Date;
  createdAt: Date;
  closedAt: Date | null;
  messages: {
    id: string;
    role: ChatMessageRole;
    content: string;
    intentKey: string | null;
    source: ChatMessageSource;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  }[];
}

interface ChatbotResponsePayload {
  sessionId: string;
  assistantMessage: string;
  intentKey: string;
  source: ChatMessageSource;
  linkedActions: string[];
  suggestedTopics: string[];
  handoffSuggested: boolean;
}

@Injectable()
export class ChatbotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly faqCatalogService: FaqCatalogService,
    private readonly intentRouter: IntentRouterService,
    private readonly cohereClient: CohereClient,
    private readonly chatbotMemberDataFacade: ChatbotMemberDataFacade,
  ) {}

  async createOrGetSession(memberId: string) {
    const session = await this.findOrCreateOpenSession(memberId);
    return {
      sessionId: session.id,
      greetingMessage:
        session.messages[0]?.content ??
        'Hello. I can help with schedules, your bookings, your membership, and simple fitness FAQs.',
      suggestedTopics: this.faqCatalogService.getSupportedTopics(),
      messages: session.messages,
    };
  }

  async getActiveSession(memberId: string) {
    const openSession = await this.prisma.chatSession.findFirst({
      where: { memberId, status: ChatSessionStatus.OPEN },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!openSession) {
      return null;
    }

    if (this.isStale(openSession.updatedAt)) {
      await this.closeSessionRecord(openSession.id);
      return null;
    }

    return {
      sessionId: openSession.id,
      status: openSession.status,
      messages: openSession.messages,
      suggestedTopics: this.faqCatalogService.getSupportedTopics(),
    };
  }

  async getMessages(memberId: string, sessionId: string) {
    const session = await this.getSessionForMember(memberId, sessionId);
    return {
      sessionId: session.id,
      status: session.status,
      messages: session.messages,
    };
  }

  async closeSession(memberId: string, sessionId: string) {
    const session = await this.getSessionForMember(memberId, sessionId);

    if (session.status === ChatSessionStatus.CLOSED) {
      return {
        sessionId: session.id,
        status: session.status,
      };
    }

    const closed = await this.closeSessionRecord(session.id);

    return {
      sessionId: closed.id,
      status: closed.status,
    };
  }

  async sendMessage(
    memberId: string,
    sessionId: string,
    message: string,
  ): Promise<ChatbotResponsePayload> {
    const session = await this.getSessionForMember(memberId, sessionId);

    if (session.status !== ChatSessionStatus.OPEN) {
      throw new BadRequestException('Chat session is already closed');
    }

    if (this.isStale(session.updatedAt)) {
      await this.closeSessionRecord(session.id);
      throw new BadRequestException('Chat session expired. Please open a new session.');
    }

    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: ChatMessageRole.USER,
        source: ChatMessageSource.USER,
        content: message,
      },
    });

    await this.touchSession(sessionId);

    const recentConversation = await this.getRecentConversation(sessionId);
    const directMatch = this.intentRouter.match(message);
    const cohereMatch =
      directMatch ??
      (await this.cohereClient.classifyMessage(
        message,
        recentConversation,
        this.faqCatalogService.getIntentCatalog(),
      ));

    const reply = await this.buildReply(memberId, message, directMatch ?? cohereMatch);

    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: ChatMessageRole.ASSISTANT,
        source: reply.source,
        content: reply.assistantMessage,
        intentKey: reply.intentKey,
        metadata: {
          linkedActions: reply.linkedActions,
          suggestedTopics: reply.suggestedTopics,
          handoffSuggested: reply.handoffSuggested,
        },
      },
    });

    await this.touchSession(sessionId);
    return {
      ...reply,
      sessionId,
    };
  }

  private async buildReply(
    memberId: string,
    message: string,
    match: IntentMatch | { intentKey: string; answer?: string } | null,
  ): Promise<Omit<ChatbotResponsePayload, 'sessionId'>> {
    if (!match) {
      return this.createFallbackReply(
        'I did not understand that request. Try one of the supported topics.',
      );
    }

    if (match.intentKey === CHATBOT_INTENTS.scheduleLookup) {
      const answer = await this.chatbotMemberDataFacade.getScheduleAnswer(
        'scheduleFilter' in match ? match.scheduleFilter : undefined,
      );
      return this.toPayload(
        answer.text,
        match.intentKey,
        ChatMessageSource.RULE,
        answer.linkedActions,
        answer.suggestedTopics,
        answer.handoffSuggested,
      );
    }

    if (match.intentKey === CHATBOT_INTENTS.bookingUpcoming) {
      const answer = await this.chatbotMemberDataFacade.getBookingsAnswer(memberId);
      return this.toPayload(
        answer.text,
        match.intentKey,
        ChatMessageSource.RULE,
        answer.linkedActions,
        answer.suggestedTopics,
        answer.handoffSuggested,
      );
    }

    if (match.intentKey === CHATBOT_INTENTS.membershipActive) {
      const answer =
        await this.chatbotMemberDataFacade.getMembershipAnswer(memberId);
      return this.toPayload(
        answer.text,
        match.intentKey,
        ChatMessageSource.RULE,
        answer.linkedActions,
        answer.suggestedTopics,
        answer.handoffSuggested,
      );
    }

    const faqAnswer = this.faqCatalogService.getAnswer(
      match.intentKey as typeof CHATBOT_INTENTS[keyof typeof CHATBOT_INTENTS],
    );

    if (faqAnswer) {
      const source =
        'answer' in match && match.answer
          ? ChatMessageSource.COHERE
          : match.intentKey === CHATBOT_INTENTS.supportHuman ||
              match.intentKey === CHATBOT_INTENTS.unsupportedTransactional
            ? ChatMessageSource.FALLBACK
            : ChatMessageSource.RULE;

      return this.toPayload(
        'answer' in match && match.answer ? match.answer : faqAnswer.text,
        match.intentKey,
        source,
        faqAnswer.linkedActions,
        this.faqCatalogService.getSupportedTopics(),
        faqAnswer.handoffSuggested,
      );
    }

    return this.createFallbackReply(
      `I cannot help with "${message}" in chat yet. Please try a supported topic or contact support.`,
    );
  }

  private createFallbackReply(
    message: string,
  ): Omit<ChatbotResponsePayload, 'sessionId'> {
    return this.toPayload(
      message,
      CHATBOT_INTENTS.unsupportedTransactional,
      ChatMessageSource.FALLBACK,
      [
        CHATBOT_LINKED_ACTIONS.booking,
        CHATBOT_LINKED_ACTIONS.membership,
        CHATBOT_LINKED_ACTIONS.support,
      ],
      this.faqCatalogService.getSupportedTopics(),
      true,
    );
  }

  private toPayload(
    assistantMessage: string,
    intentKey: string,
    source: ChatMessageSource,
    linkedActions?: string[],
    suggestedTopics?: string[],
    handoffSuggested?: boolean,
  ): Omit<ChatbotResponsePayload, 'sessionId'> {
    return {
      assistantMessage,
      intentKey,
      source,
      linkedActions: linkedActions ?? [],
      suggestedTopics:
        suggestedTopics ?? this.faqCatalogService.getSupportedTopics(),
      handoffSuggested: handoffSuggested ?? false,
    };
  }

  private async findOrCreateOpenSession(
    memberId: string,
  ): Promise<ChatSessionWithMessages> {
    const now = new Date();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const session = await this.prisma.$transaction(
          async (tx) => {
            const openSession = await tx.chatSession.findFirst({
              where: { memberId, status: ChatSessionStatus.OPEN },
              include: { messages: { orderBy: { createdAt: 'asc' } } },
              orderBy: { createdAt: 'desc' },
            });

            if (openSession && !this.isStale(openSession.updatedAt)) {
              return openSession as ChatSessionWithMessages;
            }

            if (openSession) {
              await tx.chatSession.update({
                where: { id: openSession.id },
                data: {
                  status: ChatSessionStatus.CLOSED,
                  closedAt: now,
                },
              });
            }

            return (await tx.chatSession.create({
              data: {
                memberId,
                messages: {
                  create: {
                    role: ChatMessageRole.SYSTEM,
                    source: ChatMessageSource.SYSTEM,
                    content:
                      'Hello. I can help with schedules, your bookings, your membership, and simple fitness FAQs.',
                  },
                },
              },
              include: { messages: { orderBy: { createdAt: 'asc' } } },
            })) as ChatSessionWithMessages;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return session;
      } catch (error) {
        if (!this.isConcurrencyError(error) || attempt === 2) {
          throw error;
        }
      }
    }

    const winningSession = await this.prisma.chatSession.findFirst({
      where: { memberId, status: ChatSessionStatus.OPEN },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!winningSession) {
      throw new BadRequestException('Unable to create chat session');
    }

    return winningSession as ChatSessionWithMessages;
  }

  private async getSessionForMember(
    memberId: string,
    sessionId: string,
  ): Promise<ChatSessionWithMessages> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    if (session.memberId !== memberId) {
      throw new ForbiddenException('Cannot access another member chat session');
    }

    return session as ChatSessionWithMessages;
  }

  private async closeSessionRecord(sessionId: string) {
    return this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: ChatSessionStatus.CLOSED,
        closedAt: new Date(),
      },
    });
  }

  private async touchSession(sessionId: string) {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  private async getRecentConversation(sessionId: string) {
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        sessionId,
        role: { in: [ChatMessageRole.USER, ChatMessageRole.ASSISTANT] },
      },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((entry) => ({
      role: entry.role as 'USER' | 'ASSISTANT',
      content: entry.content,
    }));
  }

  private isStale(updatedAt: Date): boolean {
    return Date.now() - updatedAt.getTime() > CHATBOT_SESSION_TTL_MS;
  }

  private isConcurrencyError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2034'].includes(error.code)
    );
  }
}
