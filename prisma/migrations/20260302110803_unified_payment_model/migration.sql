/*
  Warnings:

  - You are about to drop the column `membership_payment_id` on the `user_memberships` table. All the data in the column will be lost.
  - You are about to drop the `membership_payments` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[payment_id]` on the table `user_memberships` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentTargetType" AS ENUM ('CLASS_BOOKING', 'MEMBERSHIP');

-- DropForeignKey
ALTER TABLE "user_memberships" DROP CONSTRAINT "user_memberships_membership_payment_id_fkey";

-- DropIndex
DROP INDEX "user_memberships_membership_payment_id_key";

-- AlterTable
ALTER TABLE "user_memberships" DROP COLUMN "membership_payment_id",
ADD COLUMN     "payment_id" UUID;

-- DropTable
DROP TABLE "membership_payments";

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_type" "PaymentTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "provider" VARCHAR(20) NOT NULL DEFAULT 'STRIPE',
    "provider_session_id" TEXT,
    "provider_payment_id" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "paid_at" TIMESTAMP(6),
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_session_id_key" ON "payments"("provider_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "payments_target_type_target_id_idx" ON "payments"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_memberships_payment_id_key" ON "user_memberships"("payment_id");

-- AddForeignKey
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
