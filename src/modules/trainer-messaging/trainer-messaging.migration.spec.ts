import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('trainer-messaging migration', () => {
  it('contains the expected conversation tables and indexes', () => {
    const migrationSql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260409163000_add_trainer_messaging_v1/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE TABLE "trainer_conversations"');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "trainer_conversations_trainer_id_member_id_key"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_conversations_member_id_last_message_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_conversations_trainer_id_last_message_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE TABLE "trainer_conversation_messages"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_conversation_messages_conversation_id_created_at_idx"',
    );
  });
});
