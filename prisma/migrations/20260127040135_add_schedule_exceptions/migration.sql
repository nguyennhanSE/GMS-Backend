-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('CANCELLED', 'RESCHEDULED');

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "exception_date" DATE NOT NULL,
    "type" "ExceptionType" NOT NULL DEFAULT 'CANCELLED',
    "reason" VARCHAR(255),
    "new_start_time" TIME,
    "new_end_time" TIME,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_exceptions_schedule_id_idx" ON "schedule_exceptions"("schedule_id");

-- CreateIndex
CREATE INDEX "schedule_exceptions_exception_date_idx" ON "schedule_exceptions"("exception_date");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_exceptions_schedule_id_exception_date_key" ON "schedule_exceptions"("schedule_id", "exception_date");

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
