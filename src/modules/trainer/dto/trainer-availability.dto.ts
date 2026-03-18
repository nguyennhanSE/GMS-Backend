import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '@prisma/client';

/**
 * Single availability time slot for a trainer
 */
export class TrainerAvailabilitySlotDto {
  @ApiProperty({
    description: 'Day of week (enum)',
    example: 'MON',
    enum: DayOfWeek,
  })
  @IsEnum(DayOfWeek)
  @IsNotEmpty()
  dayOfWeek!: DayOfWeek;

  @ApiProperty({
    description: 'Start time (HH:mm format)',
    example: '09:00',
  })
  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @ApiProperty({
    description: 'End time (HH:mm format)',
    example: '17:00',
  })
  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @ApiPropertyOptional({
    description: 'Whether this slot is available',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

/**
 * DTO for setting trainer availability (bulk operation)
 */
export class SetTrainerAvailabilityDto {
  @ApiProperty({
    description: 'Array of availability time slots',
    type: [TrainerAvailabilitySlotDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrainerAvailabilitySlotDto)
  slots!: TrainerAvailabilitySlotDto[];
}
