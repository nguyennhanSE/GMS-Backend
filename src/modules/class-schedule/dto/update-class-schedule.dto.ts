import { PartialType } from '@nestjs/swagger';
import { CreateClassScheduleDto } from './create-class-schedule.dto';

export class UpdateClassScheduleDto extends PartialType(CreateClassScheduleDto) {}
