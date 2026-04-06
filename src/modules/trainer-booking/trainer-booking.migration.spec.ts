import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('trainer-booking migration', () => {
  it('contains the expected booking lookup and payment linkage indexes', () => {
    const migrationSql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260402093000_add_trainer_booking_v1/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_bookings_trainer_id_start_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_bookings_trainer_id_status_start_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_bookings_member_id_start_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_bookings_member_id_status_start_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "trainer_bookings_payment_id_idx"',
    );
  });
});
