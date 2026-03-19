import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class ClassPerformanceQueryDto {
  @ApiPropertyOptional({
    description:
      'Start date in UTC (YYYY-MM-DD). If omitted together with endDate, the report is all-time.',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'End date in UTC (YYYY-MM-DD). If omitted together with startDate, the report is all-time.',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
