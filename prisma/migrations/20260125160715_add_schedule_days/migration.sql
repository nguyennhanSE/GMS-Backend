-- AlterTable
ALTER TABLE "class_schedules" ALTER COLUMN "day_of_week" DROP NOT NULL;

-- CreateTable
CREATE TABLE "schedule_days" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_days_day_of_week_idx" ON "schedule_days"("day_of_week");

-- CreateIndex
CREATE INDEX "schedule_days_schedule_id_idx" ON "schedule_days"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_days_schedule_id_day_of_week_key" ON "schedule_days"("schedule_id", "day_of_week");

-- AddForeignKey
ALTER TABLE "schedule_days" ADD CONSTRAINT "schedule_days_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
