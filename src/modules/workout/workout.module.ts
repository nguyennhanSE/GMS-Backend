import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { WorkoutController } from './workout.controller';
import { WorkoutService } from './workout.service';

@Module({
  controllers: [WorkoutController],
  providers: [WorkoutService, PrismaService],
  exports: [WorkoutService],
})
export class WorkoutModule {}
