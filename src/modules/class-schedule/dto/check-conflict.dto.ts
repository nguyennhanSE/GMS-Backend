import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsUUID,
  IsDate,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DayOfWeek } from '@prisma/client';

export class CheckScheduleConflictDto {
  @ApiProperty({
    description: 'Trainer ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  trainerId!: string;

  @ApiProperty({
    description: 'Day of week',
    example: 'MON',
    enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  })
  @IsEnum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
  @IsNotEmpty()
  dayOfWeek!: DayOfWeek;

  @ApiProperty({
    description: 'Start time of the schedule',
    example: '2025-01-01T09:00:00Z',
  })
  @Transform(({ value }) => new Date(value as string))
  @IsDate()
  @IsNotEmpty()
  startTime!: Date;

  @ApiProperty({
    description: 'End time of the schedule',
    example: '2025-01-01T10:00:00Z',
  })
  @Transform(({ value }) => new Date(value as string))
  @IsDate()
  @IsNotEmpty()
  endTime!: Date;

  @ApiPropertyOptional({
    description: 'Schedule ID to exclude (for updates)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  excludeScheduleId?: string;
}
