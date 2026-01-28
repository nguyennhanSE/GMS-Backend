import { ClassScheduleEntity } from './class-schedule.entity';

export type DifficultyLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export class GymClassEntity {
  id!: string;
  className!: string;
  description?: string | null;
  difficultyLevel!: DifficultyLevel;
  category!: string;
  isActive!: boolean;

  createdAt?: Date | null;
  updatedAt?: Date | null;

  // Relations
  schedules?: ClassScheduleEntity[];
}
