/*
  Warnings:

  - You are about to drop the column `class_end_time` on the `class_schedules` table. All the data in the column will be lost.
  - You are about to drop the column `class_start_time` on the `class_schedules` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `class_schedules` table. All the data in the column will be lost.
  - You are about to drop the column `max_capacity` on the `class_schedules` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `class_schedules` table. All the data in the column will be lost.
  - Added the required column `class_id` to the `class_schedules` table without a default value. This is not possible if the table is not empty.
  - Added the required column `day_of_week` to the `class_schedules` table without a default value. This is not possible if the table is not empty.
  - Added the required column `end_time` to the `class_schedules` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start_time` to the `class_schedules` table without a default value. This is not possible if the table is not empty.
  - Made the column `trainer_id` on table `class_schedules` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "DifficultyLevel" AS ENUM ('Beginner', 'Intermediate', 'Advanced');

-- DropForeignKey
ALTER TABLE "class_schedules" DROP CONSTRAINT "class_schedules_trainer_id_fkey";

-- DropIndex
DROP INDEX "class_schedules_name_key";

-- AlterTable
ALTER TABLE "class_schedules" DROP COLUMN "class_end_time",
DROP COLUMN "class_start_time",
DROP COLUMN "description",
DROP COLUMN "max_capacity",
DROP COLUMN "name",
ADD COLUMN     "capacity" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "class_id" UUID NOT NULL,
ADD COLUMN     "day_of_week" "DayOfWeek" NOT NULL,
ADD COLUMN     "end_time" TIME NOT NULL,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "location" VARCHAR(255),
ADD COLUMN     "start_time" TIME NOT NULL,
ADD COLUMN     "valid_from" DATE,
ADD COLUMN     "valid_until" DATE,
ALTER COLUMN "trainer_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "gym_classes" (
    "id" UUID NOT NULL,
    "class_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "difficulty_level" "DifficultyLevel" NOT NULL DEFAULT 'Beginner',
    "category" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "gym_classes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gym_classes_class_name_key" ON "gym_classes"("class_name");

-- CreateIndex
CREATE INDEX "gym_classes_category_idx" ON "gym_classes"("category");

-- CreateIndex
CREATE INDEX "gym_classes_is_active_idx" ON "gym_classes"("is_active");

-- CreateIndex
CREATE INDEX "class_schedules_class_id_idx" ON "class_schedules"("class_id");

-- CreateIndex
CREATE INDEX "class_schedules_day_of_week_start_time_idx" ON "class_schedules"("day_of_week", "start_time");

-- CreateIndex
CREATE INDEX "class_schedules_day_of_week_is_active_capacity_idx" ON "class_schedules"("day_of_week", "is_active", "capacity");

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "gym_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
