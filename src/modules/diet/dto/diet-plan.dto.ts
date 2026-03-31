import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
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
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DietMealType, DietPlanStatus } from '@prisma/client';

export class DietPlanMealDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  sequence!: number;

  @ApiProperty({ enum: DietMealType, example: DietMealType.BREAKFAST })
  @IsEnum(DietMealType)
  mealType!: DietMealType;

  @ApiProperty({ example: 'Breakfast' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  mealTitle!: string;

  @ApiPropertyOptional({ example: '07:30:00' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}:\d{2}$/)
  scheduledTime?: string;

  @ApiPropertyOptional({ example: 'Oats, eggs, banana, black coffee' })
  @IsOptional()
  @IsString()
  foodItemsText?: string;

  @ApiProperty({ example: 520 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  calories!: number;

  @ApiPropertyOptional({ example: 35 })
  @Type(() => Number)
  @IsOptional()
  @Min(0)
  proteinGrams?: number;

  @ApiPropertyOptional({ example: 55 })
  @Type(() => Number)
  @IsOptional()
  @Min(0)
  carbsGrams?: number;

  @ApiPropertyOptional({ example: 18 })
  @Type(() => Number)
  @IsOptional()
  @Min(0)
  fatGrams?: number;

  @ApiPropertyOptional({ example: 'Prioritize hydration before this meal' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateDietPlanDto {
  @ApiProperty({ example: 'Lean Bulk Daily Plan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 'High-protein daily plan for weekday training' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ example: 30 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  durationDays?: number;

  @ApiPropertyOptional({ example: 2400 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  calorieTarget?: number;

  @ApiProperty({ type: [DietPlanMealDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DietPlanMealDto)
  meals!: DietPlanMealDto[];
}

export class UpdateDietPlanDto extends PartialType(
  OmitType(CreateDietPlanDto, [] as const),
) {
  @ApiPropertyOptional({ enum: DietPlanStatus, example: DietPlanStatus.ACTIVE })
  @IsOptional()
  @IsEnum(DietPlanStatus)
  status?: DietPlanStatus;
}
