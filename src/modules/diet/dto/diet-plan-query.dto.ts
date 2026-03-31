import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DietPlanStatus } from '@prisma/client';

export class DietPlanQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: DietPlanStatus, example: DietPlanStatus.ACTIVE })
  @IsOptional()
  @IsEnum(DietPlanStatus)
  status?: DietPlanStatus;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;
}
