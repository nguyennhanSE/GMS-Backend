import { Module } from '@nestjs/common';
import { TrainerService } from './trainer.service';
import { TrainerController } from './trainer.controller';
import { TrainerRepository } from './repositories/trainer.repository';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TrainerController],
  providers: [TrainerService, TrainerRepository],
  exports: [TrainerService, TrainerRepository],
})
export class TrainerModule {}
