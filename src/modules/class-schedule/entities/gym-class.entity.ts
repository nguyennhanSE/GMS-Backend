import { ClassScheduleEntity } from './class-schedule.entity';

export type DifficultyLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export class GymClassEntity {
  id!: string;
  className!: string;
  description?: string | null;
  difficultyLevel!: DifficultyLevel;
  category!: string;
  isActive!: boolean;
  imageUrl?: string | null;
  imageKey?: string | null;

  createdAt?: Date | null;
  updatedAt?: Date | null;

  // Relations
  schedules?: ClassScheduleEntity[];
}
