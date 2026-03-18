import { Module } from '@nestjs/common';
import { ClassScheduleService } from './class-schedule.service';
import { ClassScheduleController } from './class-schedule.controller';
import { ClassScheduleRepository } from './repositories/class-schedule.repository';
import { PrismaService } from 'prisma/prisma.service';
import { ScheduleExceptionController } from './schedule-exception.controller';
import { ScheduleExceptionService } from './schedule-exception.service';
import { ScheduleExceptionRepository } from './repositories/schedule-exception.repository';
import { TrainerModule } from '../trainer/trainer.module';

@Module({
  imports: [TrainerModule],
  controllers: [ClassScheduleController, ScheduleExceptionController],
  providers: [
    ClassScheduleService,
    ClassScheduleRepository,
    ScheduleExceptionService,
    ScheduleExceptionRepository,
    PrismaService,
  ],
  exports: [
    ClassScheduleService,
    ClassScheduleRepository,
    ScheduleExceptionService,
    ScheduleExceptionRepository,
  ],
})
export class ClassScheduleModule {}
