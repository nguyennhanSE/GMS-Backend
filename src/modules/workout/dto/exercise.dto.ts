import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExerciseDto {
  @ApiProperty({ example: 'Back Squat', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Compound lower-body barbell movement' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'Strength', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category!: string;

  @ApiPropertyOptional({ example: 'Barbell', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  equipmentRequired?: string;
}

export class UpdateExerciseDto extends PartialType(CreateExerciseDto) {}
