import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateExerciseSetLogDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  exerciseId!: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001' })
  @IsOptional()
  @IsUUID()
  planItemId?: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  setNumber!: number;

  @ApiProperty({ example: 8 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  actualRep!: number;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  actualWeight!: number;

  @ApiPropertyOptional({ example: 7 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  rpe?: number;
}
