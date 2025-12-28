/*
  Warnings:

  - A unique constraint covering the columns `[membership_payment_id]` on the table `user_memberships` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "user_memberships" ADD COLUMN     "membership_payment_id" UUID;

-- CreateTable
CREATE TABLE "membership_payments" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "gateway_name" TEXT NOT NULL,
    "gateway_transaction_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "membership_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_payments_membershipId_idx" ON "membership_payments"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "user_memberships_membership_payment_id_key" ON "user_memberships"("membership_payment_id");

-- AddForeignKey
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_membership_payment_id_fkey" FOREIGN KEY ("membership_payment_id") REFERENCES "membership_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
