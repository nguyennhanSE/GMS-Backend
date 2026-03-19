import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export const REPORTING_INTERVALS = ['day', 'week', 'month'] as const;

export type ReportingInterval = (typeof REPORTING_INTERVALS)[number];

export class RevenueAnalyticsQueryDto {
  @ApiPropertyOptional({
    description:
      'Start date in UTC (YYYY-MM-DD). Defaults to the last 6 months when both dates are omitted.',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'End date in UTC (YYYY-MM-DD). Defaults to the current UTC date when both dates are omitted.',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Bucket interval for revenue aggregation.',
    enum: REPORTING_INTERVALS,
    example: 'month',
    default: 'month',
  })
  @IsOptional()
  @IsIn(REPORTING_INTERVALS)
  interval?: ReportingInterval;
}
