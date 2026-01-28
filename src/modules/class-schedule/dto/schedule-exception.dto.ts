import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Exception types for schedule modifications
 */
export enum ExceptionTypeDto {
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
}

/**
 * DTO for creating a schedule exception (holiday, closure, reschedule)
 */
export class CreateScheduleExceptionDto {
  @ApiProperty({
    description: 'Date when the exception applies',
    example: '2025-12-25',
  })
  @IsNotEmpty()
  @IsDateString()
  exceptionDate!: string;

  @ApiProperty({
    description: 'Type of exception',
    enum: ExceptionTypeDto,
    example: ExceptionTypeDto.CANCELLED,
  })
  @IsNotEmpty()
  @IsEnum(ExceptionTypeDto)
  type!: ExceptionTypeDto;

  @ApiPropertyOptional({
    description: 'Reason for the exception',
    example: 'Christmas Day - Gym Closed',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    description: 'New start time if rescheduled (HH:mm or HH:mm:ss format)',
    example: '10:00',
  })
  @ValidateIf((o) => o.type === ExceptionTypeDto.RESCHEDULED)
  @IsOptional()
  @IsString()
  newStartTime?: string;

  @ApiPropertyOptional({
    description: 'New end time if rescheduled (HH:mm or HH:mm:ss format)',
    example: '11:00',
  })
  @ValidateIf((o) => o.type === ExceptionTypeDto.RESCHEDULED)
  @IsOptional()
  @IsString()
  newEndTime?: string;
}

/**
 * DTO for updating a schedule exception
 */
export class UpdateScheduleExceptionDto {
  @ApiPropertyOptional({
    description: 'Type of exception',
    enum: ExceptionTypeDto,
  })
  @IsOptional()
  @IsEnum(ExceptionTypeDto)
  type?: ExceptionTypeDto;

  @ApiPropertyOptional({
    description: 'Reason for the exception',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    description: 'New start time if rescheduled',
    example: '10:00',
  })
  @IsOptional()
  @IsString()
  newStartTime?: string;

  @ApiPropertyOptional({
    description: 'New end time if rescheduled',
    example: '11:00',
  })
  @IsOptional()
  @IsString()
  newEndTime?: string;
}

/**
 * Response DTO for schedule exception
 */
export class ScheduleExceptionResponseDto {
  @ApiProperty({ description: 'Exception ID' })
  id!: string;

  @ApiProperty({ description: 'Schedule ID' })
  scheduleId!: string;

  @ApiProperty({ description: 'Exception date' })
  exceptionDate!: Date;

  @ApiProperty({ enum: ExceptionTypeDto })
  type!: ExceptionTypeDto;

  @ApiPropertyOptional({ description: 'Reason for exception' })
  reason?: string | null;

  @ApiPropertyOptional({ description: 'New start time if rescheduled' })
  newStartTime?: Date | null;

  @ApiPropertyOptional({ description: 'New end time if rescheduled' })
  newEndTime?: Date | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiPropertyOptional({ description: 'Last update timestamp' })
  updatedAt?: Date | null;
}
