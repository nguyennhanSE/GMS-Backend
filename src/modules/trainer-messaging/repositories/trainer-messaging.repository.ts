import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

type TrainerMessagingParticipantRecord = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

export type TrainerMessagingConversationRecord = {
  id: string;
  trainerId: string;
  memberId: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  memberLastReadAt: Date | null;
  trainerLastReadAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  member: TrainerMessagingParticipantRecord;
  trainer: TrainerMessagingParticipantRecord;
};

export type TrainerMessagingMessageRecord = {
  id: string;
  conversationId: string;
  senderUserId: string;
  content: string;
  createdAt: Date;
};

@Injectable()
export class TrainerMessagingRepository {
  constructor(private readonly prisma: PrismaService) {}

  listConversationsForUser(
    userId: string,
  ): Promise<TrainerMessagingConversationRecord[]> {
    return this.prisma.$queryRaw<TrainerMessagingConversationRecord[]>`
      SELECT
        c.id,
        c.trainer_id AS "trainerId",
        c.member_id AS "memberId",
        c.last_message_at AS "lastMessageAt",
        c.last_message_preview AS "lastMessagePreview",
        c.member_last_read_at AS "memberLastReadAt",
        c.trainer_last_read_at AS "trainerLastReadAt",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt",
        json_build_object(
          'id', member_user.id,
          'firstName', member_user.first_name,
          'lastName', member_user.last_name,
          'avatarUrl', member_user.avatar_url
        ) AS member,
        json_build_object(
          'id', trainer_user.id,
          'firstName', trainer_user.first_name,
          'lastName', trainer_user.last_name,
          'avatarUrl', trainer_user.avatar_url
        ) AS trainer
      FROM trainer_conversations c
      JOIN users member_user ON member_user.id = c.member_id
      JOIN users trainer_user ON trainer_user.id = c.trainer_id
      WHERE c.member_id = ${userId}::uuid OR c.trainer_id = ${userId}::uuid
      ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
    `;
  }

  async findConversationById(
    conversationId: string,
  ): Promise<TrainerMessagingConversationRecord | null> {
    const conversations =
      await this.prisma.$queryRaw<TrainerMessagingConversationRecord[]>`
        SELECT
          c.id,
          c.trainer_id AS "trainerId",
          c.member_id AS "memberId",
          c.last_message_at AS "lastMessageAt",
          c.last_message_preview AS "lastMessagePreview",
          c.member_last_read_at AS "memberLastReadAt",
          c.trainer_last_read_at AS "trainerLastReadAt",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          json_build_object(
            'id', member_user.id,
            'firstName', member_user.first_name,
            'lastName', member_user.last_name,
            'avatarUrl', member_user.avatar_url
          ) AS member,
          json_build_object(
            'id', trainer_user.id,
            'firstName', trainer_user.first_name,
            'lastName', trainer_user.last_name,
            'avatarUrl', trainer_user.avatar_url
          ) AS trainer
        FROM trainer_conversations c
        JOIN users member_user ON member_user.id = c.member_id
        JOIN users trainer_user ON trainer_user.id = c.trainer_id
        WHERE c.id = ${conversationId}::uuid
      `;

    return conversations[0] ?? null;
  }

  async createOrGetConversation(
    memberId: string,
    trainerId: string,
  ): Promise<TrainerMessagingConversationRecord> {
    const conversationId = randomUUID();

    await this.prisma.$executeRaw`
      INSERT INTO trainer_conversations (
        id,
        trainer_id,
        member_id,
        created_at,
        updated_at
      )
      VALUES (
        ${conversationId}::uuid,
        ${trainerId}::uuid,
        ${memberId}::uuid,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (trainer_id, member_id) DO NOTHING
    `;

    const conversation = await this.findConversationByPair(memberId, trainerId);
    if (!conversation) {
      throw new Error('Failed to create or load trainer conversation');
    }

    return conversation;
  }

  listMessages(
    conversationId: string,
    limit: number,
    beforeMessageAt?: Date,
  ): Promise<TrainerMessagingMessageRecord[]> {
    if (beforeMessageAt) {
      return this.prisma.$queryRaw<TrainerMessagingMessageRecord[]>`
        SELECT
          id,
          conversation_id AS "conversationId",
          sender_user_id AS "senderUserId",
          content,
          created_at AS "createdAt"
        FROM trainer_conversation_messages
        WHERE conversation_id = ${conversationId}::uuid
          AND created_at < ${beforeMessageAt}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return this.prisma.$queryRaw<TrainerMessagingMessageRecord[]>`
      SELECT
        id,
        conversation_id AS "conversationId",
        sender_user_id AS "senderUserId",
        content,
        created_at AS "createdAt"
      FROM trainer_conversation_messages
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  async appendMessage(params: {
    conversationId: string;
    senderUserId: string;
    content: string;
    preview: string;
    actor: 'member' | 'trainer';
  }): Promise<TrainerMessagingMessageRecord> {
    const messageId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const messages = await tx.$queryRaw<TrainerMessagingMessageRecord[]>`
        INSERT INTO trainer_conversation_messages (
          id,
          conversation_id,
          sender_user_id,
          content,
          created_at
        )
        VALUES (
          ${messageId}::uuid,
          ${params.conversationId}::uuid,
          ${params.senderUserId}::uuid,
          ${params.content},
          CURRENT_TIMESTAMP
        )
        RETURNING
          id,
          conversation_id AS "conversationId",
          sender_user_id AS "senderUserId",
          content,
          created_at AS "createdAt"
      `;

      const message = messages[0];
      if (!message) {
        throw new Error('Failed to persist trainer conversation message');
      }

      if (params.actor === 'member') {
        await tx.$executeRaw`
          UPDATE trainer_conversations
          SET last_message_at = ${message.createdAt},
              last_message_preview = ${params.preview},
              member_last_read_at = ${message.createdAt},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${params.conversationId}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE trainer_conversations
          SET last_message_at = ${message.createdAt},
              last_message_preview = ${params.preview},
              trainer_last_read_at = ${message.createdAt},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${params.conversationId}::uuid
        `;
      }

      return message;
    });
  }

  async markConversationRead(
    conversationId: string,
    actor: 'member' | 'trainer',
    readAt: Date,
  ): Promise<void> {
    if (actor === 'member') {
      await this.prisma.$executeRaw`
        UPDATE trainer_conversations
        SET member_last_read_at = ${readAt},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${conversationId}::uuid
      `;
      return;
    }

    await this.prisma.$executeRaw`
      UPDATE trainer_conversations
      SET trainer_last_read_at = ${readAt},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${conversationId}::uuid
    `;
  }

  async countUnreadMessages(params: {
    conversationId: string;
    viewerUserId: string;
    lastReadAt: Date | null;
  }): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM trainer_conversation_messages
      WHERE conversation_id = ${params.conversationId}::uuid
        AND sender_user_id <> ${params.viewerUserId}::uuid
        AND (
          ${params.lastReadAt}::timestamp IS NULL
          OR created_at > ${params.lastReadAt}
        )
    `;

    return Number(result[0]?.count ?? 0n);
  }

  private async findConversationByPair(
    memberId: string,
    trainerId: string,
  ): Promise<TrainerMessagingConversationRecord | null> {
    const conversations =
      await this.prisma.$queryRaw<TrainerMessagingConversationRecord[]>`
        SELECT
          c.id,
          c.trainer_id AS "trainerId",
          c.member_id AS "memberId",
          c.last_message_at AS "lastMessageAt",
          c.last_message_preview AS "lastMessagePreview",
          c.member_last_read_at AS "memberLastReadAt",
          c.trainer_last_read_at AS "trainerLastReadAt",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          json_build_object(
            'id', member_user.id,
            'firstName', member_user.first_name,
            'lastName', member_user.last_name,
            'avatarUrl', member_user.avatar_url
          ) AS member,
          json_build_object(
            'id', trainer_user.id,
            'firstName', trainer_user.first_name,
            'lastName', trainer_user.last_name,
            'avatarUrl', trainer_user.avatar_url
          ) AS trainer
        FROM trainer_conversations c
        JOIN users member_user ON member_user.id = c.member_id
        JOIN users trainer_user ON trainer_user.id = c.trainer_id
        WHERE c.member_id = ${memberId}::uuid
          AND c.trainer_id = ${trainerId}::uuid
      `;

    return conversations[0] ?? null;
  }
}
