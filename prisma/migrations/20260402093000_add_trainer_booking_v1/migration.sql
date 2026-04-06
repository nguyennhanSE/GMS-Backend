ALTER TYPE "PaymentTargetType" ADD VALUE 'TRAINER_BOOKING';

ALTER TABLE "users"
  ADD COLUMN "pt_session_price_30" INTEGER NOT NULL DEFAULT 150000,
  ADD COLUMN "pt_session_price_60" INTEGER NOT NULL DEFAULT 250000,
  ADD COLUMN "pt_session_price_90" INTEGER NOT NULL DEFAULT 350000,
  ADD COLUMN "trainer_specialization" VARCHAR(255),
  ADD COLUMN "trainer_experience_years" INTEGER,
  ADD COLUMN "trainer_biography" TEXT,
  ADD COLUMN "trainer_certifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "trainer_areas_of_expertise" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "TrainerBookingStatus" AS ENUM (
  'PENDING_REVIEW',
  'REJECTED',
  'ACCEPTED_PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'EXPIRED'
);

CREATE TABLE "trainer_bookings" (
  "id" UUID NOT NULL,
  "member_id" UUID NOT NULL,
  "trainer_id" UUID NOT NULL,
  "start_at" TIMESTAMP(6) NOT NULL,
  "end_at" TIMESTAMP(6) NOT NULL,
  "status" "TrainerBookingStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "price" DECIMAL(10,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
  "payment_id" UUID,
  "notes" TEXT,
  "cancelled_at" TIMESTAMP(6),
  "cancel_reason" TEXT,
  "rescheduled_from_booking_id" UUID,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trainer_bookings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trainer_bookings_payment_id_key" ON "trainer_bookings"("payment_id");
CREATE INDEX "trainer_bookings_trainer_id_start_at_idx" ON "trainer_bookings"("trainer_id", "start_at");
CREATE INDEX "trainer_bookings_trainer_id_status_start_at_idx" ON "trainer_bookings"("trainer_id", "status", "start_at");
CREATE INDEX "trainer_bookings_member_id_start_at_idx" ON "trainer_bookings"("member_id", "start_at");
CREATE INDEX "trainer_bookings_member_id_status_start_at_idx" ON "trainer_bookings"("member_id", "status", "start_at");
CREATE INDEX "trainer_bookings_payment_id_idx" ON "trainer_bookings"("payment_id");

ALTER TABLE "trainer_bookings"
  ADD CONSTRAINT "trainer_bookings_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trainer_bookings"
  ADD CONSTRAINT "trainer_bookings_trainer_id_fkey"
  FOREIGN KEY ("trainer_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trainer_bookings"
  ADD CONSTRAINT "trainer_bookings_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trainer_bookings"
  ADD CONSTRAINT "trainer_bookings_rescheduled_from_booking_id_fkey"
  FOREIGN KEY ("rescheduled_from_booking_id") REFERENCES "trainer_bookings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
