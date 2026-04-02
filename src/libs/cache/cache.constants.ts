export const APP_CACHE_STATE = Symbol('APP_CACHE_STATE');
export const APP_CACHE_DEFAULT_TTL_SECONDS = 300;
export const APP_CACHE_TAG_TTL_SECONDS = 24 * 60 * 60;

export const CACHE_TAGS = {
  CLASS_SCHEDULE_LIST: 'class-schedule:list',
  CLASS_SCHEDULE_DETAIL: 'class-schedule:detail',
  CLASS_SCHEDULE_DAY: 'class-schedule:day',
  CLASS_SCHEDULE_TRAINER: 'class-schedule:trainer',
  TRAINER_LIST: 'trainer:list',
  TRAINER_DETAIL: 'trainer:detail',
  MEMBERSHIP_LIST: 'membership:list',
  MEMBERSHIP_DETAIL: 'membership:detail',
  REPORTING_SUMMARY: 'reporting:summary',
  REPORTING_ANALYTICS: 'reporting:analytics',
  WORKOUT_EXERCISES: 'workout:exercises',
} as const;

