import { Module } from '@nestjs/common';
import { ClassBookingService } from './class-booking.service';
import { ClassBookingController } from './class-booking.controller';
import { ClassBookingRepository } from './repositories/class-booking.repository';
import { PrismaService } from 'prisma/prisma.service';
import { ClassScheduleModule } from '../class-schedule/class-schedule.module';
import { BookingPaymentConsumer } from './booking-payment.consumer';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [ClassScheduleModule, PaymentModule],
  controllers: [ClassBookingController, BookingPaymentConsumer],
  providers: [
    ClassBookingService,
    ClassBookingRepository,
    PrismaService,
  ],
  exports: [ClassBookingService, ClassBookingRepository],
})
export class ClassBookingModule {}
