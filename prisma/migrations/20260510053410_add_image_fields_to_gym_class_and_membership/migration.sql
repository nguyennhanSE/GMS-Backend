-- AlterTable
ALTER TABLE "gym_classes" ADD COLUMN     "image_key" TEXT,
ADD COLUMN     "image_url" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "logo_key" TEXT,
ADD COLUMN     "logo_url" TEXT;

-- AlterTable
ALTER TABLE "trainer_bookings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "trainer_conversations" ALTER COLUMN "updated_at" DROP DEFAULT;
