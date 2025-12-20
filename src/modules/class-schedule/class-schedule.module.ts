import { Module } from '@nestjs/common';
import { ClassScheduleService } from './class-schedule.service';
import { ClassScheduleController } from './class-schedule.controller';
import { ClassScheduleRepository } from './repositories/class-schedule.repository';
import { PrismaService } from 'prisma/prisma.service';

@Module({
  controllers: [ClassScheduleController],
  providers: [ClassScheduleService, ClassScheduleRepository, PrismaService],
  exports: [ClassScheduleService, ClassScheduleRepository],
})
export class ClassScheduleModule {}
