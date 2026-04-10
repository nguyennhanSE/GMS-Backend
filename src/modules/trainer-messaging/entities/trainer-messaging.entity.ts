export type TrainerMessagingParticipant = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

export type TrainerMessagingContact = TrainerMessagingParticipant & {
  conversationId: string | null;
};

export type TrainerMessagingConversationSummary = {
  conversationId: string;
  partner: TrainerMessagingParticipant;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TrainerMessagingConversationMessage = {
  id: string;
  senderUserId: string;
  content: string;
  createdAt: Date;
  isOwn: boolean;
};

export type TrainerMessagingConversationMessagesPage = {
  conversationId: string;
  partner: TrainerMessagingParticipant;
  unreadCount: number;
  nextCursor: string | null;
  messages: TrainerMessagingConversationMessage[];
};
