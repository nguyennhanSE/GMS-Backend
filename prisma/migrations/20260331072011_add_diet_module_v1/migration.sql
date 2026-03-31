-- CreateEnum
CREATE TYPE "TrainerClientLinkStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "DietPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DietPlanVisibility" AS ENUM ('PRIVATE', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "DietMealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'PRE_WORKOUT', 'POST_WORKOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "DietPlanAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED', 'REMOVED');

-- CreateTable
CREATE TABLE "trainer_client_links" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "TrainerClientLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "linked_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(6),
    "end_reason" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_client_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_plans" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "duration_days" INTEGER,
    "calorie_target" INTEGER,
    "status" "DietPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "DietPlanVisibility" NOT NULL DEFAULT 'PRIVATE',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "diet_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_plan_meals" (
    "id" UUID NOT NULL,
    "diet_plan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "meal_type" "DietMealType" NOT NULL,
    "meal_title" VARCHAR(255) NOT NULL,
    "scheduled_time" TIME,
    "food_items_text" TEXT,
    "calories" INTEGER NOT NULL,
    "protein_grams" DECIMAL(6,2),
    "carbs_grams" DECIMAL(6,2),
    "fat_grams" DECIMAL(6,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "diet_plan_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_plan_assignments" (
    "id" UUID NOT NULL,
    "diet_plan_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "DietPlanAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assigned_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(6),
    "end_reason" TEXT,

    CONSTRAINT "diet_plan_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trainer_client_links_trainer_id_member_id_status_idx" ON "trainer_client_links"("trainer_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "trainer_client_links_member_id_status_idx" ON "trainer_client_links"("member_id", "status");

-- CreateIndex
CREATE INDEX "diet_plans_trainer_id_status_idx" ON "diet_plans"("trainer_id", "status");

-- CreateIndex
CREATE INDEX "diet_plans_trainer_id_visibility_idx" ON "diet_plans"("trainer_id", "visibility");

-- CreateIndex
CREATE INDEX "diet_plans_status_visibility_idx" ON "diet_plans"("status", "visibility");

-- CreateIndex
CREATE INDEX "diet_plan_meals_diet_plan_id_sequence_idx" ON "diet_plan_meals"("diet_plan_id", "sequence");

-- CreateIndex
CREATE INDEX "diet_plan_meals_meal_type_idx" ON "diet_plan_meals"("meal_type");

-- CreateIndex
CREATE UNIQUE INDEX "diet_plan_meals_diet_plan_id_sequence_key" ON "diet_plan_meals"("diet_plan_id", "sequence");

-- CreateIndex
CREATE INDEX "diet_plan_assignments_diet_plan_id_status_idx" ON "diet_plan_assignments"("diet_plan_id", "status");

-- CreateIndex
CREATE INDEX "diet_plan_assignments_member_id_status_idx" ON "diet_plan_assignments"("member_id", "status");

-- CreateIndex
CREATE INDEX "diet_plan_assignments_effective_from_effective_to_idx" ON "diet_plan_assignments"("effective_from", "effective_to");

-- AddForeignKey
ALTER TABLE "trainer_client_links" ADD CONSTRAINT "trainer_client_links_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_client_links" ADD CONSTRAINT "trainer_client_links_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plans" ADD CONSTRAINT "diet_plans_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plan_meals" ADD CONSTRAINT "diet_plan_meals_diet_plan_id_fkey" FOREIGN KEY ("diet_plan_id") REFERENCES "diet_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plan_assignments" ADD CONSTRAINT "diet_plan_assignments_diet_plan_id_fkey" FOREIGN KEY ("diet_plan_id") REFERENCES "diet_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plan_assignments" ADD CONSTRAINT "diet_plan_assignments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
