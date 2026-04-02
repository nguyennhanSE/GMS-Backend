import {
  hashCacheInput,
  stripDefaultValue,
  stripEmptyValue,
} from '../../libs/cache/cache.utils';

export const REPORTING_SUMMARY_TTL_SECONDS = 60;
export const REPORTING_ANALYTICS_TTL_SECONDS = 300;

export function buildReportingSummaryKey(): string {
  return 'gms:reporting:summary-kpis';
}

export function buildRevenueAnalyticsKey(query: {
  interval?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const signature = hashCacheInput({
    interval: stripDefaultValue(query.interval, 'month'),
    startDate: stripEmptyValue(query.startDate),
    endDate: stripEmptyValue(query.endDate),
  });

  return `gms:reporting:revenue:${signature}`;
}

export function buildClassPerformanceKey(query: {
  startDate?: string;
  endDate?: string;
}): string {
  const signature = hashCacheInput({
    startDate: stripEmptyValue(query.startDate),
    endDate: stripEmptyValue(query.endDate),
  });

  return `gms:reporting:class-performance:${signature}`;
}

