CREATE TYPE "ChatSessionStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "ChatMessageSource" AS ENUM ('USER', 'RULE', 'COHERE', 'FALLBACK', 'SYSTEM');

CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "ChatSessionStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(6),

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_sessions_status_closed_at_chk" CHECK (
        ("status" = 'OPEN' AND "closed_at" IS NULL) OR
        ("status" = 'CLOSED' AND "closed_at" IS NOT NULL)
    )
);

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "intent_key" VARCHAR(100),
    "source" "ChatMessageSource" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "chat_sessions_member_id_status_idx" ON "chat_sessions"("member_id", "status");
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");
CREATE UNIQUE INDEX "chat_sessions_member_id_open_idx" ON "chat_sessions"("member_id") WHERE "status" = 'OPEN';
