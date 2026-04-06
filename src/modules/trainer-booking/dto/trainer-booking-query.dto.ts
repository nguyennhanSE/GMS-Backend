import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class TrainerBookingTrainerQueryDto {
  @ApiPropertyOptional({ example: 'strength' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 'Strength & Conditioning' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  specialization?: string;

  @ApiPropertyOptional({ example: '2026-04-10T00:00:00.000Z', type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date?: Date;

  @ApiPropertyOptional({
    example: true,
    description:
      'When true, only return trainers that have at least one matching available slot for the requested date or any configured availability when no date is provided.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') {
      return true;
    }
    if (value === false || value === 'false') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  availableOnly?: boolean;

  @ApiPropertyOptional({ example: 150000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({ example: 500000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number;
}

export class TrainerBookingSlotsQueryDto {
  @ApiPropertyOptional({ example: '2026-04-10T00:00:00.000Z', type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ example: '2026-04-16T00:00:00.000Z', type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
