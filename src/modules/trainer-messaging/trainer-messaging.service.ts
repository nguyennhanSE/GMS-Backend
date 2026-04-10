import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { TrainerBookingService } from '../trainer-booking/trainer-booking.service';
import { ERoleName } from '../roles/enums/role.enum';
import {
  TrainerMessagingContact,
  TrainerMessagingConversationMessagesPage,
  TrainerMessagingConversationSummary,
  TrainerMessagingParticipant,
} from './entities/trainer-messaging.entity';
import {
  toTrainerMessagingContact,
  toTrainerMessagingConversationMessage,
  toTrainerMessagingConversationSummary,
} from './mapper/trainer-messaging.mapper';
import { TrainerMessageQueryDto } from './dto/trainer-message-query.dto';
import { TrainerMessagingRepository } from './repositories/trainer-messaging.repository';

type ConversationRecord = NonNullable<
  Awaited<ReturnType<TrainerMessagingRepository['findConversationById']>>
>;

@Injectable()
export class TrainerMessagingService {
  constructor(
    private readonly trainerMessagingRepository: TrainerMessagingRepository,
    private readonly trainerBookingService: TrainerBookingService,
  ) {}

  async listContacts(user: RequestUser): Promise<TrainerMessagingContact[]> {
    this.ensureMessagingUser(user);

    const [eligibleContacts, conversations] = await Promise.all([
      this.listEligibleContactsForUser(user),
      this.trainerMessagingRepository.listConversationsForUser(user.sub),
    ]);

    const conversationIdsByPartnerId = new Map<string, string>();
    for (const conversation of conversations) {
      const partnerId = this.getPartnerId(conversation, user.sub);
      if (partnerId) {
        conversationIdsByPartnerId.set(partnerId, conversation.id);
      }
    }

    return eligibleContacts.map((contact) =>
      toTrainerMessagingContact(
        contact,
        conversationIdsByPartnerId.get(contact.id) ?? null,
      ),
    );
  }

  async listConversations(
    user: RequestUser,
  ): Promise<TrainerMessagingConversationSummary[]> {
    this.ensureMessagingUser(user);

    const [conversations, eligibility] = await Promise.all([
      this.trainerMessagingRepository.listConversationsForUser(user.sub),
      this.getEligibilitySets(user),
    ]);

    const accessibleConversations = conversations.filter((conversation) =>
      this.isConversationEligibleForUser(conversation, user.sub, eligibility),
    );

    return Promise.all(
      accessibleConversations.map(async (conversation) =>
        toTrainerMessagingConversationSummary({
          conversationId: conversation.id,
          partner: this.getPartner(conversation, user.sub),
          lastMessageAt: conversation.lastMessageAt,
          lastMessagePreview: conversation.lastMessagePreview,
          unreadCount: await this.trainerMessagingRepository.countUnreadMessages({
            conversationId: conversation.id,
            viewerUserId: user.sub,
            lastReadAt: this.getLastReadAt(conversation, user.sub),
          }),
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        }),
      ),
    );
  }

  async createOrGetConversation(
    user: RequestUser,
    partnerId: string,
  ): Promise<TrainerMessagingConversationSummary> {
    this.ensureMessagingUser(user);

    const pair = await this.resolveEligiblePairOrThrow(user, partnerId);
    const conversation =
      await this.trainerMessagingRepository.createOrGetConversation(
        pair.memberId,
        pair.trainerId,
      );

    return toTrainerMessagingConversationSummary({
      conversationId: conversation.id,
      partner: this.getPartner(conversation, user.sub),
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      unreadCount: await this.trainerMessagingRepository.countUnreadMessages({
        conversationId: conversation.id,
        viewerUserId: user.sub,
        lastReadAt: this.getLastReadAt(conversation, user.sub),
      }),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  }

  async getMessages(
    user: RequestUser,
    conversationId: string,
    query: TrainerMessageQueryDto,
  ): Promise<TrainerMessagingConversationMessagesPage> {
    const conversation = await this.getAccessibleConversationOrThrow(
      conversationId,
      user,
    );
    const limit = query.limit ?? 50;
    const messages = await this.trainerMessagingRepository.listMessages(
      conversation.id,
      limit + 1,
      query.beforeMessageAt,
    );
    const hasMore = messages.length > limit;
    const visibleMessages = hasMore ? messages.slice(0, limit) : messages;
    const oldestVisibleMessage = visibleMessages[visibleMessages.length - 1];

    return {
      conversationId: conversation.id,
      partner: this.getPartner(conversation, user.sub),
      unreadCount: await this.trainerMessagingRepository.countUnreadMessages({
        conversationId: conversation.id,
        viewerUserId: user.sub,
        lastReadAt: this.getLastReadAt(conversation, user.sub),
      }),
      nextCursor:
        hasMore && oldestVisibleMessage
          ? oldestVisibleMessage.createdAt.toISOString()
          : null,
      messages: visibleMessages
        .slice()
        .reverse()
        .map((message) =>
          toTrainerMessagingConversationMessage({
            id: message.id,
            senderUserId: message.senderUserId,
            content: message.content,
            createdAt: message.createdAt,
            viewerUserId: user.sub,
          }),
        ),
    };
  }

  async sendMessage(
    user: RequestUser,
    conversationId: string,
    content: string,
  ): Promise<TrainerMessagingConversationMessagesPage> {
    const conversation = await this.getAccessibleConversationOrThrow(
      conversationId,
      user,
    );
    const actor = this.getConversationActor(conversation, user.sub);
    const normalizedContent = content.trim();
    if (normalizedContent.length === 0) {
      throw new BadRequestException('Message content cannot be empty');
    }
    await this.trainerMessagingRepository.appendMessage({
      conversationId: conversation.id,
      senderUserId: user.sub,
      content: normalizedContent,
      preview: this.buildMessagePreview(normalizedContent),
      actor,
    });

    return this.getMessages(user, conversationId, { limit: 50 });
  }

  async markConversationRead(
    user: RequestUser,
    conversationId: string,
  ): Promise<{ conversationId: string; readAt: Date }> {
    const conversation = await this.getAccessibleConversationOrThrow(
      conversationId,
      user,
    );
    const actor = this.getConversationActor(conversation, user.sub);
    const readAt = new Date();

    await this.trainerMessagingRepository.markConversationRead(
      conversation.id,
      actor,
      readAt,
    );

    return {
      conversationId: conversation.id,
      readAt,
    };
  }

  private async getAccessibleConversationOrThrow(
    conversationId: string,
    user: RequestUser,
  ): Promise<ConversationRecord> {
    const conversation =
      await this.trainerMessagingRepository.findConversationById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        `Trainer messaging conversation ${conversationId} not found`,
      );
    }

    if (!this.isConversationParticipant(conversation, user.sub)) {
      throw new ForbiddenException(
        'You are not allowed to access this conversation',
      );
    }

    const isEligible = await this.trainerBookingService.isMessagingEligible(
      conversation.memberId,
      conversation.trainerId,
    );

    if (!isEligible) {
      throw new ForbiddenException(
        'Messaging is not available for this trainer-member pair',
      );
    }

    return conversation;
  }

  private async resolveEligiblePairOrThrow(
    user: RequestUser,
    partnerId: string,
  ): Promise<{ memberId: string; trainerId: string }> {
    if (
      this.hasRole(user, ERoleName.MEMBER) &&
      (await this.trainerBookingService.isMessagingEligible(user.sub, partnerId))
    ) {
      return {
        memberId: user.sub,
        trainerId: partnerId,
      };
    }

    if (
      this.hasRole(user, ERoleName.TRAINER) &&
      (await this.trainerBookingService.isMessagingEligible(partnerId, user.sub))
    ) {
      return {
        memberId: partnerId,
        trainerId: user.sub,
      };
    }

    throw new ForbiddenException(
      'Messaging is not available for this trainer-member pair',
    );
  }

  private async listEligibleContactsForUser(
    user: RequestUser,
  ): Promise<TrainerMessagingParticipant[]> {
    const contacts = new Map<string, TrainerMessagingParticipant>();

    if (this.hasRole(user, ERoleName.MEMBER)) {
      const trainers =
        await this.trainerBookingService.listMessagingEligibleTrainers(user.sub);
      for (const trainer of trainers) {
        contacts.set(trainer.id, trainer);
      }
    }

    if (this.hasRole(user, ERoleName.TRAINER)) {
      const members =
        await this.trainerBookingService.listMessagingEligibleMembers(user.sub);
      for (const member of members) {
        contacts.set(member.id, member);
      }
    }

    return [...contacts.values()];
  }

  private async getEligibilitySets(user: RequestUser): Promise<{
    eligibleTrainerIds: Set<string>;
    eligibleMemberIds: Set<string>;
  }> {
    const [eligibleTrainers, eligibleMembers] = await Promise.all([
      this.hasRole(user, ERoleName.MEMBER)
        ? this.trainerBookingService.listMessagingEligibleTrainers(user.sub)
        : Promise.resolve([]),
      this.hasRole(user, ERoleName.TRAINER)
        ? this.trainerBookingService.listMessagingEligibleMembers(user.sub)
        : Promise.resolve([]),
    ]);

    return {
      eligibleTrainerIds: new Set(eligibleTrainers.map((trainer) => trainer.id)),
      eligibleMemberIds: new Set(eligibleMembers.map((member) => member.id)),
    };
  }

  private isConversationEligibleForUser(
    conversation: ConversationRecord,
    userId: string,
    eligibility: {
      eligibleTrainerIds: Set<string>;
      eligibleMemberIds: Set<string>;
    },
  ): boolean {
    if (conversation.memberId === userId) {
      return eligibility.eligibleTrainerIds.has(conversation.trainerId);
    }

    if (conversation.trainerId === userId) {
      return eligibility.eligibleMemberIds.has(conversation.memberId);
    }

    return false;
  }

  private getPartner(
    conversation: ConversationRecord,
    userId: string,
  ): TrainerMessagingParticipant {
    return conversation.memberId === userId
      ? conversation.trainer
      : conversation.member;
  }

  private getPartnerId(
    conversation: ConversationRecord,
    userId: string,
  ): string | null {
    if (conversation.memberId === userId) {
      return conversation.trainerId;
    }

    if (conversation.trainerId === userId) {
      return conversation.memberId;
    }

    return null;
  }

  private getConversationActor(
    conversation: ConversationRecord,
    userId: string,
  ): 'member' | 'trainer' {
    return conversation.memberId === userId ? 'member' : 'trainer';
  }

  private getLastReadAt(
    conversation: ConversationRecord,
    userId: string,
  ): Date | null {
    return conversation.memberId === userId
      ? conversation.memberLastReadAt
      : conversation.trainerLastReadAt;
  }

  private isConversationParticipant(
    conversation: ConversationRecord,
    userId: string,
  ): boolean {
    return conversation.memberId === userId || conversation.trainerId === userId;
  }

  private buildMessagePreview(content: string): string {
    return content.length <= 160 ? content : `${content.slice(0, 160)}...`;
  }

  private ensureMessagingUser(user: RequestUser): void {
    if (
      !this.hasRole(user, ERoleName.MEMBER) &&
      !this.hasRole(user, ERoleName.TRAINER)
    ) {
      throw new ForbiddenException(
        'Only members and trainers can access trainer messaging',
      );
    }
  }

  private hasRole(user: RequestUser, role: ERoleName): boolean {
    return user.roles.includes(role);
  }
}
