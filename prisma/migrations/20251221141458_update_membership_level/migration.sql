-- CreateEnum
CREATE TYPE "MembershipLevel" AS ENUM ('BASIC', 'PREMIUM', 'ELITE');

-- AlterTable
ALTER TABLE "class_schedules" ADD COLUMN     "trainer_id" UUID;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "level" "MembershipLevel" NOT NULL DEFAULT 'BASIC';

-- AlterTable
ALTER TABLE "user_memberships" ADD COLUMN     "level" "MembershipLevel" NOT NULL DEFAULT 'BASIC';

-- CreateTable
CREATE TABLE "trainer_availabilities" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "trainer_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trainer_availabilities_trainer_id_idx" ON "trainer_availabilities"("trainer_id");

-- CreateIndex
CREATE INDEX "trainer_availabilities_trainer_id_day_of_week_idx" ON "trainer_availabilities"("trainer_id", "day_of_week");

-- CreateIndex
CREATE INDEX "class_schedules_trainer_id_idx" ON "class_schedules"("trainer_id");

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_availabilities" ADD CONSTRAINT "trainer_availabilities_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
