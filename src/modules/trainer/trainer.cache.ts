import { CACHE_TAGS } from '../../libs/cache/cache.constants';
import {
  hashCacheInput,
  stripDefaultValue,
  stripEmptyValue,
} from '../../libs/cache/cache.utils';
import type { PaginateOptions } from '../../libs/models/paginate/pagimate.model';
import type { TrainerFilterDto } from './dto/trainer-filter.dto';

export const TRAINER_LIST_TTL_SECONDS = 300;
export const TRAINER_AVAILABILITY_TTL_SECONDS = 120;

export function buildTrainerListKey(
  paginateRequest: PaginateOptions,
  filter: TrainerFilterDto,
  counted?: boolean,
): string {
  const signature = hashCacheInput({
    page: stripDefaultValue(paginateRequest.page, 1),
    limit: stripDefaultValue(paginateRequest.limit, 10),
    sort: stripDefaultValue(paginateRequest.sort, 'asc'),
    sortBy: stripDefaultValue(paginateRequest.sortBy, 'createdAt'),
    counted: stripDefaultValue(counted ?? true, true),
    filter: {
      q: stripEmptyValue(filter.q),
      email: stripEmptyValue(filter.email),
      searchField: stripEmptyValue(filter.searchField),
    },
  });

  return `gms:trainer:list:${signature}`;
}

export function buildTrainerDetailKey(trainerId: string): string {
  return `gms:trainer:detail:${trainerId}`;
}

export function buildTrainerAvailabilityKey(trainerId: string): string {
  return `gms:trainer:availability:${trainerId}`;
}

export function buildTrainerIdTag(trainerId: string): string {
  return `trainer:id:${trainerId}`;
}

export function buildTrainerAvailabilityTag(trainerId: string): string {
  return `trainer:availability:${trainerId}`;
}

export function trainerListTags(): string[] {
  return [CACHE_TAGS.TRAINER_LIST];
}

export function trainerDetailTags(trainerId: string): string[] {
  return [CACHE_TAGS.TRAINER_DETAIL, buildTrainerIdTag(trainerId)];
}

export function trainerAvailabilityTags(trainerId: string): string[] {
  return [buildTrainerAvailabilityTag(trainerId)];
}

export function buildTrainerInvalidationTags(options: {
  trainerId: string;
  includeList?: boolean;
  includeAvailability?: boolean;
}): string[] {
  const tags = new Set<string>([buildTrainerIdTag(options.trainerId)]);

  if (options.includeList) {
    tags.add(CACHE_TAGS.TRAINER_LIST);
  }

  if (options.includeAvailability) {
    tags.add(buildTrainerAvailabilityTag(options.trainerId));
  }

  return [...tags];
}

