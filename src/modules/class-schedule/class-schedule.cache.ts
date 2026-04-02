import { CACHE_TAGS } from '../../libs/cache/cache.constants';
import {
  hashCacheInput,
  stripDefaultValue,
  stripEmptyValue,
} from '../../libs/cache/cache.utils';
import type { PaginateOptions } from '../../libs/models/paginate/pagimate.model';
import type { ClassScheduleFilterDto } from './repositories/class-schedule.repository';

export const CLASS_SCHEDULE_LIST_TTL_SECONDS = 300;
export const CLASS_SCHEDULE_DATE_AWARE_TTL_SECONDS = 60;

function formatTargetDate(targetDate?: Date): string | undefined {
  return targetDate?.toISOString().split('T')[0];
}

export function buildClassScheduleListKey(
  paginateRequest: PaginateOptions,
  filter: ClassScheduleFilterDto,
  counted?: boolean,
  targetDate?: Date,
): string {
  const signature = hashCacheInput({
    page: stripDefaultValue(paginateRequest.page, 1),
    limit: stripDefaultValue(paginateRequest.limit, 10),
    sort: stripDefaultValue(paginateRequest.sort, 'asc'),
    sortBy: stripDefaultValue(paginateRequest.sortBy, 'createdAt'),
    counted: stripDefaultValue(counted ?? true, true),
    targetDate: formatTargetDate(targetDate),
    filter: {
      q: stripEmptyValue(filter.q),
      searchField: stripEmptyValue(filter.searchField),
      dayOfWeek: stripEmptyValue(filter.dayOfWeek),
      trainerId: stripEmptyValue(filter.trainerId),
      classId: stripEmptyValue(filter.classId),
      isActive: filter.isActive,
    },
  });

  return `gms:class-schedule:list:${signature}`;
}

export function buildClassScheduleDetailKey(
  scheduleId: string,
  targetDate?: Date,
): string {
  const suffix = formatTargetDate(targetDate);
  return suffix
    ? `gms:class-schedule:detail:${scheduleId}:${suffix}`
    : `gms:class-schedule:detail:${scheduleId}`;
}

export function buildClassScheduleDayKey(dayOfWeek: string): string {
  return `gms:class-schedule:day:${dayOfWeek}`;
}

export function buildClassScheduleTrainerKey(trainerId: string): string {
  return `gms:class-schedule:trainer:${trainerId}`;
}

export function buildClassScheduleIdTag(scheduleId: string): string {
  return `class-schedule:id:${scheduleId}`;
}

export function classScheduleListTags(): string[] {
  return [CACHE_TAGS.CLASS_SCHEDULE_LIST];
}

export function classScheduleDetailTags(scheduleId: string): string[] {
  return [CACHE_TAGS.CLASS_SCHEDULE_DETAIL, buildClassScheduleIdTag(scheduleId)];
}

export function classScheduleDayTags(): string[] {
  return [CACHE_TAGS.CLASS_SCHEDULE_DAY];
}

export function classScheduleTrainerTags(trainerId: string): string[] {
  return [CACHE_TAGS.CLASS_SCHEDULE_TRAINER, `class-schedule:trainer:${trainerId}`];
}

export function buildClassScheduleInvalidationTags(options: {
  scheduleId?: string;
  trainerIds?: string[];
}): string[] {
  const tags = new Set<string>([
    CACHE_TAGS.CLASS_SCHEDULE_LIST,
    CACHE_TAGS.CLASS_SCHEDULE_DETAIL,
    CACHE_TAGS.CLASS_SCHEDULE_DAY,
    CACHE_TAGS.CLASS_SCHEDULE_TRAINER,
  ]);

  if (options.scheduleId) {
    tags.add(buildClassScheduleIdTag(options.scheduleId));
  }

  for (const trainerId of options.trainerIds ?? []) {
    tags.add(`class-schedule:trainer:${trainerId}`);
  }

  return [...tags];
}

