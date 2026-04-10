import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { TrainerBookingModule } from '../trainer-booking/trainer-booking.module';
import { TrainerMessagingController } from './trainer-messaging.controller';
import { TrainerMessagingRepository } from './repositories/trainer-messaging.repository';
import { TrainerMessagingService } from './trainer-messaging.service';

@Module({
  imports: [PrismaModule, TrainerBookingModule],
  controllers: [TrainerMessagingController],
  providers: [TrainerMessagingService, TrainerMessagingRepository],
  exports: [TrainerMessagingService, TrainerMessagingRepository],
})
export class TrainerMessagingModule {}
