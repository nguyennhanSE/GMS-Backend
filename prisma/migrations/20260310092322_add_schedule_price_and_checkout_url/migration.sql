-- AlterTable
ALTER TABLE "class_schedules" ADD COLUMN     "price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "checkout_url" TEXT;
