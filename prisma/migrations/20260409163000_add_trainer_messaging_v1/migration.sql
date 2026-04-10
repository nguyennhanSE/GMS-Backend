CREATE TABLE "trainer_conversations" (
  "id" UUID NOT NULL,
  "trainer_id" UUID NOT NULL,
  "member_id" UUID NOT NULL,
  "last_message_at" TIMESTAMP(6),
  "last_message_preview" TEXT,
  "member_last_read_at" TIMESTAMP(6),
  "trainer_last_read_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trainer_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trainer_conversation_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "sender_user_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trainer_conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trainer_conversations_trainer_id_member_id_key"
  ON "trainer_conversations"("trainer_id", "member_id");
CREATE INDEX "trainer_conversations_member_id_last_message_at_idx"
  ON "trainer_conversations"("member_id", "last_message_at");
CREATE INDEX "trainer_conversations_trainer_id_last_message_at_idx"
  ON "trainer_conversations"("trainer_id", "last_message_at");
CREATE INDEX "trainer_conversation_messages_conversation_id_created_at_idx"
  ON "trainer_conversation_messages"("conversation_id", "created_at");
CREATE INDEX "trainer_conversation_messages_sender_user_id_created_at_idx"
  ON "trainer_conversation_messages"("sender_user_id", "created_at");

ALTER TABLE "trainer_conversations"
  ADD CONSTRAINT "trainer_conversations_trainer_id_fkey"
  FOREIGN KEY ("trainer_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trainer_conversations"
  ADD CONSTRAINT "trainer_conversations_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trainer_conversation_messages"
  ADD CONSTRAINT "trainer_conversation_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "trainer_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trainer_conversation_messages"
  ADD CONSTRAINT "trainer_conversation_messages_sender_user_id_fkey"
  FOREIGN KEY ("sender_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
