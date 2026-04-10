import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

export class TrainerMessageQueryDto {
  @ApiPropertyOptional({
    description: 'Return messages created before this timestamp',
    example: '2026-04-09T12:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  beforeMessageAt?: Date;

  @ApiPropertyOptional({
    description: 'Maximum number of messages to return',
    default: 50,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
