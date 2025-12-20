import { Module } from '@nestjs/common';
import { ClassBookingService } from './class-booking.service';
import { ClassBookingController } from './class-booking.controller';
import { ClassBookingRepository } from './repositories/class-booking.repository';
import { PrismaService } from 'prisma/prisma.service';
import { ClassScheduleModule } from '../class-schedule/class-schedule.module';
import { ClassScheduleService } from '../class-schedule/class-schedule.service';

@Module({
  imports: [ClassScheduleModule],
  controllers: [ClassBookingController],
  providers: [ClassBookingService, ClassBookingRepository, PrismaService, ClassScheduleService],
  exports: [ClassBookingService, ClassBookingRepository],
})
export class ClassBookingModule {}
