import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsDate,
  IsUUID,
  IsEnum,
  IsInt,
  IsBoolean,
  Min,
  Max,
  IsArray,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

// Day of week enum matching Prisma schema
export enum DayOfWeekDto {
  MON = 'MON',
  TUE = 'TUE',
  WED = 'WED',
  THU = 'THU',
  FRI = 'FRI',
  SAT = 'SAT',
  SUN = 'SUN',
}

export class CreateClassScheduleDto {
  @ApiProperty({
    description: 'GymClass ID (the class template)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  classId!: string;

  @ApiProperty({
    description: 'Trainer ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  trainerId!: string;

  @ApiPropertyOptional({
    description:
      'Day of week for recurring schedule (legacy - use daysOfWeek for multi-day)',
    example: 'MON',
    enum: DayOfWeekDto,
  })
  @ValidateIf((o) => !o.daysOfWeek || o.daysOfWeek.length === 0)
  @IsEnum(DayOfWeekDto)
  @IsOptional()
  dayOfWeek?: DayOfWeekDto;

  @ApiPropertyOptional({
    description: 'Days of week for recurring schedule (supports multiple days)',
    example: ['MON', 'WED', 'FRI'],
    type: [String],
    enum: DayOfWeekDto,
    isArray: true,
  })
  @ValidateIf((o) => !o.dayOfWeek)
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(DayOfWeekDto, { each: true })
  @IsOptional()
  daysOfWeek?: DayOfWeekDto[];

  @ApiProperty({
    description: 'Start time of the class',
    example: '2025-01-01T09:00:00Z',
  })
  @IsDate()
  @IsNotEmpty()
  @Transform(({ value }) => {
    if (!value) return new Date();
    return new Date(String(value));
  })
  startTime!: Date;

  @ApiProperty({
    description: 'End time of the class',
    example: '2025-01-01T10:00:00Z',
  })
  @IsDate()
  @IsNotEmpty()
  @Transform(({ value }) => {
    if (!value) return new Date();
    return new Date(String(value));
  })
  endTime!: Date;

  @ApiPropertyOptional({
    description: 'Schedule valid from date',
    example: '2025-01-01',
  })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => (value ? new Date(String(value)) : null))
  validFrom?: Date | null;

  @ApiPropertyOptional({
    description: 'Schedule valid until date',
    example: '2025-12-31',
  })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => (value ? new Date(String(value)) : null))
  validUntil?: Date | null;

  @ApiPropertyOptional({
    description: 'Location of the class',
    example: 'Studio A',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.trim())
  location?: string;

  @ApiPropertyOptional({
    description: 'Maximum capacity',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  @ApiPropertyOptional({
    description: 'Whether schedule is active',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
