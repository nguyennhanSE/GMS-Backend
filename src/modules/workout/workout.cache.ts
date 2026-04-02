import { CACHE_TAGS } from '../../libs/cache/cache.constants';

export const WORKOUT_EXERCISES_TTL_SECONDS = 1800;

export function buildWorkoutExercisesKey(): string {
  return 'gms:workout:exercises';
}

export function workoutExerciseTags(): string[] {
  return [CACHE_TAGS.WORKOUT_EXERCISES];
}

