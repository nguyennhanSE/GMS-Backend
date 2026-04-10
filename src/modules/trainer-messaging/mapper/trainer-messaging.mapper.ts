import {
  TrainerMessagingContact,
  TrainerMessagingConversationMessage,
  TrainerMessagingConversationSummary,
  TrainerMessagingParticipant,
} from '../entities/trainer-messaging.entity';

type MessagingUser = TrainerMessagingParticipant;

export function toTrainerMessagingParticipant(
  user: MessagingUser,
): TrainerMessagingParticipant {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
  };
}

export function toTrainerMessagingContact(
  user: MessagingUser,
  conversationId: string | null,
): TrainerMessagingContact {
  return {
    ...toTrainerMessagingParticipant(user),
    conversationId,
  };
}

export function toTrainerMessagingConversationSummary(params: {
  conversationId: string;
  partner: MessagingUser;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}): TrainerMessagingConversationSummary {
  return {
    conversationId: params.conversationId,
    partner: toTrainerMessagingParticipant(params.partner),
    lastMessageAt: params.lastMessageAt,
    lastMessagePreview: params.lastMessagePreview,
    unreadCount: params.unreadCount,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  };
}

export function toTrainerMessagingConversationMessage(params: {
  id: string;
  senderUserId: string;
  content: string;
  createdAt: Date;
  viewerUserId: string;
}): TrainerMessagingConversationMessage {
  return {
    id: params.id,
    senderUserId: params.senderUserId,
    content: params.content,
    createdAt: params.createdAt,
    isOwn: params.senderUserId === params.viewerUserId,
  };
}
