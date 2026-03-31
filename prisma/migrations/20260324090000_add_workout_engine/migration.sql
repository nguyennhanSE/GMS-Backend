CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "WorkoutPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkoutPlanVisibility" AS ENUM ('PRIVATE', 'ASSIGNED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "WorkoutSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100) NOT NULL,
    "equipment_required" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plans" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "duration_minutes" INTEGER,
    "status" "WorkoutPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "WorkoutPlanVisibility" NOT NULL DEFAULT 'PRIVATE',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_assignments" (
    "id" UUID NOT NULL,
    "workout_plan_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_plan_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_items" (
    "id" UUID NOT NULL,
    "workout_plan_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "target_set" INTEGER,
    "target_rep" INTEGER,
    "target_weight" DECIMAL(6,2),
    "day_of_week" "DayOfWeek",
    "notes" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "workout_plan_id" UUID,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "status" "WorkoutSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_set_logs" (
    "id" UUID NOT NULL,
    "workout_session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "plan_item_id" UUID,
    "set_number" INTEGER NOT NULL,
    "actual_rep" INTEGER NOT NULL,
    "actual_weight" DECIMAL(6,2) NOT NULL,
    "rpe" SMALLINT,
    "completed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_set_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exercises_name_key" ON "exercises"("name");

-- CreateIndex
CREATE INDEX "exercises_category_idx" ON "exercises"("category");

-- CreateIndex
CREATE INDEX "workout_plans_trainer_id_visibility_idx" ON "workout_plans"("trainer_id", "visibility");

-- CreateIndex
CREATE INDEX "workout_plans_trainer_id_status_idx" ON "workout_plans"("trainer_id", "status");

-- CreateIndex
CREATE INDEX "workout_plans_visibility_status_idx" ON "workout_plans"("visibility", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workout_plan_assignments_workout_plan_id_member_id_key" ON "workout_plan_assignments"("workout_plan_id", "member_id");

-- CreateIndex
CREATE INDEX "workout_plan_assignments_member_id_idx" ON "workout_plan_assignments"("member_id");

-- CreateIndex
CREATE INDEX "workout_plan_assignments_workout_plan_id_idx" ON "workout_plan_assignments"("workout_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_items_workout_plan_id_sequence_key" ON "plan_items"("workout_plan_id", "sequence");

-- CreateIndex
CREATE INDEX "plan_items_workout_plan_id_sequence_idx" ON "plan_items"("workout_plan_id", "sequence");

-- CreateIndex
CREATE INDEX "plan_items_exercise_id_idx" ON "plan_items"("exercise_id");

-- CreateIndex
CREATE INDEX "plan_items_day_of_week_idx" ON "plan_items"("day_of_week");

-- CreateIndex
CREATE INDEX "workout_sessions_member_id_start_time_idx" ON "workout_sessions"("member_id", "start_time");

-- CreateIndex
CREATE INDEX "workout_sessions_workout_plan_id_idx" ON "workout_sessions"("workout_plan_id");

-- CreateIndex
CREATE INDEX "workout_sessions_status_idx" ON "workout_sessions"("status");

-- CreateIndex
CREATE INDEX "exercise_set_logs_workout_session_id_set_number_idx" ON "exercise_set_logs"("workout_session_id", "set_number");

-- CreateIndex
CREATE INDEX "exercise_set_logs_exercise_id_idx" ON "exercise_set_logs"("exercise_id");

-- CreateIndex
CREATE INDEX "exercise_set_logs_plan_item_id_idx" ON "exercise_set_logs"("plan_item_id");

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_assignments" ADD CONSTRAINT "workout_plan_assignments_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_assignments" ADD CONSTRAINT "workout_plan_assignments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_set_logs" ADD CONSTRAINT "exercise_set_logs_workout_session_id_fkey" FOREIGN KEY ("workout_session_id") REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_set_logs" ADD CONSTRAINT "exercise_set_logs_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_set_logs" ADD CONSTRAINT "exercise_set_logs_plan_item_id_fkey" FOREIGN KEY ("plan_item_id") REFERENCES "plan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_duration_minutes_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" > 0);

ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_target_set_check" CHECK ("target_set" IS NULL OR "target_set" > 0);
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_target_rep_check" CHECK ("target_rep" IS NULL OR "target_rep" > 0);
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_target_weight_check" CHECK ("target_weight" IS NULL OR "target_weight" > 0);

ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_end_time_check" CHECK ("end_time" IS NULL OR "end_time" >= "start_time");

ALTER TABLE "exercise_set_logs" ADD CONSTRAINT "exercise_set_logs_rpe_check" CHECK ("rpe" IS NULL OR ("rpe" BETWEEN 1 AND 10));
ALTER TABLE "exercise_set_logs" ADD CONSTRAINT "exercise_set_logs_actual_rep_check" CHECK ("actual_rep" > 0);
ALTER TABLE "exercise_set_logs" ADD CONSTRAINT "exercise_set_logs_actual_weight_check" CHECK ("actual_weight" > 0);
