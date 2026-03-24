import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export enum WorkoutPlanStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum WorkoutPlanVisibilityDto {
  PRIVATE = 'PRIVATE',
  ASSIGNED = 'ASSIGNED',
  PUBLIC = 'PUBLIC',
}

export class WorkoutPlanItemDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  exerciseId!: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  sequence!: number;

  @ApiPropertyOptional({ example: 4 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetSet?: number;

  @ApiPropertyOptional({ example: 8 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetRep?: number;

  @ApiPropertyOptional({ example: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsPositive()
  targetWeight?: number;

  @ApiPropertyOptional({ enum: DayOfWeek, example: DayOfWeek.MON })
  @IsOptional()
  @IsEnum(DayOfWeek)
  dayOfWeek?: DayOfWeek;

  @ApiPropertyOptional({ example: 'Use RPE 7 on the last set' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateWorkoutPlanDto {
  @ApiProperty({ example: 'Lower Body Strength A', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 60 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  duration?: number;

  @ApiPropertyOptional({ enum: WorkoutPlanStatusDto, example: WorkoutPlanStatusDto.DRAFT })
  @IsOptional()
  @IsEnum(WorkoutPlanStatusDto)
  status?: WorkoutPlanStatusDto;

  @ApiPropertyOptional({
    enum: WorkoutPlanVisibilityDto,
    example: WorkoutPlanVisibilityDto.PRIVATE,
  })
  @IsOptional()
  @IsEnum(WorkoutPlanVisibilityDto)
  visibility?: WorkoutPlanVisibilityDto;

  @ApiPropertyOptional({
    type: [String],
    example: [
      '123e4567-e89b-12d3-a456-426614174001',
      '123e4567-e89b-12d3-a456-426614174002',
    ],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assignedMemberIds?: string[];

  @ApiProperty({ type: [WorkoutPlanItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkoutPlanItemDto)
  planItems!: WorkoutPlanItemDto[];
}

export class UpdateWorkoutPlanDto extends PartialType(
  OmitType(CreateWorkoutPlanDto, ['planItems'] as const),
) {}
