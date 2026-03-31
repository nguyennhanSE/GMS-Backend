import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { TrainerModule } from '../trainer/trainer.module';
import { DietController } from './diet.controller';
import { DietService } from './diet.service';

@Module({
  imports: [PrismaModule, TrainerModule],
  controllers: [DietController],
  providers: [DietService],
  exports: [DietService],
})
export class DietModule {}
