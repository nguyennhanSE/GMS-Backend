/*
  Warnings:

  - A unique constraint covering the columns `[user_id,class_schedule_id]` on the table `class_bookings` will be added. If there are existing duplicate values, this will fail.
  - Made the column `status` on table `class_bookings` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "class_bookings" ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "class_schedules" ADD COLUMN     "max_capacity" INTEGER NOT NULL DEFAULT 20;

-- CreateIndex
CREATE INDEX "class_bookings_class_schedule_id_status_idx" ON "class_bookings"("class_schedule_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "class_bookings_user_id_class_schedule_id_key" ON "class_bookings"("user_id", "class_schedule_id");
