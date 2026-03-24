import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateWorkoutSessionDto {
  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  workoutPlanId?: string;

  @ApiProperty({ example: '2026-03-24T08:00:00.000Z', type: Date })
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  startTime!: Date;

  @ApiPropertyOptional({ example: 'Felt strong today' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CompleteWorkoutSessionDto {
  @ApiProperty({ example: '2026-03-24T09:05:00.000Z', type: Date })
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  endTime!: Date;

  @ApiPropertyOptional({ example: 'Completed with one extra warmup set' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
