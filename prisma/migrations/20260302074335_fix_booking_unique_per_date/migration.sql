/*
  Warnings:

  - A unique constraint covering the columns `[user_id,class_schedule_id,booking_start_date]` on the table `class_bookings` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "class_bookings_user_id_class_schedule_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "class_bookings_user_id_class_schedule_id_booking_start_date_key" ON "class_bookings"("user_id", "class_schedule_id", "booking_start_date");
