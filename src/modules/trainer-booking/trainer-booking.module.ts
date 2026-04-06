import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentModule } from '../payment/payment.module';
import { TrainerBookingExpiryCronService } from './cron/trainer-booking-expiry.cron';
import { TrainerBookingReminderCronService } from './cron/trainer-booking-reminder.cron';
import { TrainerBookingController } from './trainer-booking.controller';
import { TrainerBookingPaymentConsumer } from './trainer-booking.consumer';
import { TrainerBookingRepository } from './repositories/trainer-booking.repository';
import { TrainerBookingService } from './trainer-booking.service';

@Module({
  imports: [PaymentModule],
  controllers: [TrainerBookingController, TrainerBookingPaymentConsumer],
  providers: [
    TrainerBookingService,
    TrainerBookingRepository,
    TrainerBookingExpiryCronService,
    TrainerBookingReminderCronService,
    PrismaService,
  ],
  exports: [TrainerBookingService, TrainerBookingRepository],
})
export class TrainerBookingModule {}
