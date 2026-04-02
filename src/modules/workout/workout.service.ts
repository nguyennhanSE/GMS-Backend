import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DayOfWeek,
  Prisma,
  WorkoutPlanStatus,
  WorkoutPlanVisibility,
  WorkoutSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { CreateExerciseDto, UpdateExerciseDto } from './dto/exercise.dto';
import {
  CreateWorkoutPlanDto,
  WorkoutPlanItemDto,
  WorkoutPlanStatusDto,
  WorkoutPlanVisibilityDto,
} from './dto/workout-plan.dto';
import {
  CompleteWorkoutSessionDto,
  CreateWorkoutSessionDto,
} from './dto/workout-session.dto';
import { CreateExerciseSetLogDto } from './dto/exercise-set-log.dto';
import { AppCacheService } from '../../libs/cache/cache.service';
import {
  buildWorkoutExercisesKey,
  workoutExerciseTags,
  WORKOUT_EXERCISES_TTL_SECONDS,
} from './workout.cache';

type ExerciseView = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  equipmentRequired: string | null;
  createdAt: Date;
  updatedAt: Date | null;
};

type WorkoutPlanItemView = {
  id: string;
  workoutPlanId: string;
  exerciseId: string;
  sequence: number;
  targetSet: number | null;
  targetRep: number | null;
  targetWeight: number | null;
  dayOfWeek: DayOfWeek | null;
  notes: string | null;
  exercise: ExerciseView;
};

type WorkoutPlanAssignmentView = {
  id: string;
  workoutPlanId: string;
  memberId: string;
  assignedAt: Date;
  member: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
};

type WorkoutPlanView = {
  id: string;
  trainerId: string;
  title: string;
  duration: number | null;
  status: WorkoutPlanStatus;
  visibility: WorkoutPlanVisibility;
  createdAt: Date;
  updatedAt: Date | null;
  trainer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  planItems: WorkoutPlanItemView[];
  assignments?: WorkoutPlanAssignmentView[];
};

type WorkoutSessionSetLogView = {
  id: string;
  workoutSessionId: string;
  exerciseId: string;
  planItemId: string | null;
  setNumber: number;
  actualRep: number;
  actualWeight: number;
  rpe: number | null;
  completedAt: Date;
  exercise: ExerciseView;
  planItem: WorkoutPlanItemView | null;
  prescribedExercise: ExerciseView | null;
  isSubstitution: boolean;
};

type WorkoutSessionView = {
  id: string;
  memberId: string;
  workoutPlanId: string | null;
  startTime: Date;
  endTime: Date | null;
  status: WorkoutSessionStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  workoutPlan: {
    id: string;
    title: string;
    visibility: WorkoutPlanVisibility;
    trainerId: string;
  } | null;
  setLogs: WorkoutSessionSetLogView[];
  isPlanDeleted: boolean;
};

@Injectable()
export class WorkoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appCacheService: AppCacheService,
  ) {}

  async listExercises(): Promise<ExerciseView[]> {
    return this.appCacheService.remember(
      buildWorkoutExercisesKey(),
      async () => {
        const exercises = await this.prisma.exercise.findMany({
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        });

        return exercises.map((exercise) => this.mapExercise(exercise));
      },
      {
        ttlSeconds: WORKOUT_EXERCISES_TTL_SECONDS,
        tags: workoutExerciseTags(),
      },
    );
  }

  async createExercise(dto: CreateExerciseDto): Promise<ExerciseView> {
    try {
      const exercise = await this.prisma.exercise.create({
        data: dto,
      });
      await this.appCacheService.invalidateTags(workoutExerciseTags());
      return this.mapExercise(exercise);
    } catch (error) {
      this.handlePrismaError(error, 'Exercise');
    }
  }

  async updateExercise(id: string, dto: UpdateExerciseDto): Promise<ExerciseView> {
    await this.ensureExerciseExists(id);

    try {
      const exercise = await this.prisma.exercise.update({
        where: { id },
        data: dto,
      });
      await this.appCacheService.invalidateTags(workoutExerciseTags());
      return this.mapExercise(exercise);
    } catch (error) {
      this.handlePrismaError(error, 'Exercise');
    }
  }

  async deleteExercise(id: string): Promise<{ message: string }> {
    await this.ensureExerciseExists(id);

    try {
      await this.prisma.exercise.delete({
        where: { id },
      });
      await this.appCacheService.invalidateTags(workoutExerciseTags());
      return { message: `Exercise ${id} deleted successfully` };
    } catch (error) {
      if (this.isForeignKeyConflict(error)) {
        throw new ConflictException(
          'Exercise is referenced by workout plans or logs',
        );
      }
      this.handlePrismaError(error, 'Exercise');
    }
  }

  async createWorkoutPlan(
    user: RequestUser,
    dto: CreateWorkoutPlanDto,
  ): Promise<WorkoutPlanView> {
    this.ensureTrainer(user);
    const assignedMemberIds = [...new Set(dto.assignedMemberIds ?? [])];
    await this.ensureExercisesExist(dto.planItems.map((item) => item.exerciseId));
    await this.ensureAssignedMembersExist(assignedMemberIds);

    if (
      dto.visibility === WorkoutPlanVisibilityDto.ASSIGNED &&
      assignedMemberIds.length === 0
    ) {
      throw new BadRequestException(
        'Assigned plans require at least one assigned member',
      );
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      return tx.workoutPlan.create({
        data: {
          trainerId: user.sub,
          title: dto.title,
          duration: dto.duration ?? null,
          status: (dto.status ?? WorkoutPlanStatusDto.DRAFT) as WorkoutPlanStatus,
          visibility: (dto.visibility ?? WorkoutPlanVisibilityDto.PRIVATE) as WorkoutPlanVisibility,
          planItems: {
            create: dto.planItems.map((item) => this.mapPlanItemCreateInput(item)),
          },
          assignments: assignedMemberIds.length
            ? {
                create: assignedMemberIds.map((memberId) => ({
                  memberId,
                })),
              }
            : undefined,
        },
        include: this.planDetailInclude(true),
      });
    });

    return this.mapWorkoutPlan(plan, true);
  }

  async listWorkoutPlans(user: RequestUser): Promise<WorkoutPlanView[]> {
    const plans: WorkoutPlanView[] = [];
    const isTrainer = user.roles.includes(ERoleName.TRAINER);
    const isMember = user.roles.includes(ERoleName.MEMBER);

    if (isTrainer) {
      const trainerPlans = await this.prisma.workoutPlan.findMany({
        where: { trainerId: user.sub },
        include: this.planSummaryInclude(),
        orderBy: [{ createdAt: 'desc' }],
      });
      plans.push(...trainerPlans.map((plan) => this.mapWorkoutPlan(plan)));
    }

    if (isMember) {
      const memberPlans = await this.prisma.workoutPlan.findMany({
        where: {
          OR: [
            { visibility: WorkoutPlanVisibility.PUBLIC },
            {
              visibility: WorkoutPlanVisibility.ASSIGNED,
              assignments: {
                some: {
                  memberId: user.sub,
                },
              },
            },
          ],
        },
        include: this.planSummaryInclude(),
        orderBy: [{ createdAt: 'desc' }],
      });
      plans.push(...memberPlans.map((plan) => this.mapWorkoutPlan(plan)));
    }

    return this.uniquePlansById(plans);
  }

  async getWorkoutPlan(id: string, user: RequestUser): Promise<WorkoutPlanView> {
    const plan = await this.prisma.workoutPlan.findUnique({
      where: { id },
      include: this.planDetailInclude(true),
    });

    if (!plan) {
      throw new NotFoundException(`Workout plan ${id} not found`);
    }

    this.assertPlanAccess(plan, user);

    return this.mapWorkoutPlan(
      plan,
      plan.trainerId === user.sub && user.roles.includes(ERoleName.TRAINER),
    );
  }

  async deleteWorkoutPlan(
    id: string,
    user: RequestUser,
  ): Promise<{ message: string }> {
    const plan = await this.prisma.workoutPlan.findUnique({
      where: { id },
      select: { id: true, trainerId: true },
    });

    if (!plan) {
      throw new NotFoundException(`Workout plan ${id} not found`);
    }

    if (plan.trainerId !== user.sub) {
      throw new ForbiddenException('You can only delete your own workout plans');
    }

    await this.prisma.workoutPlan.delete({ where: { id } });
    return { message: `Workout plan ${id} deleted successfully` };
  }

  async createWorkoutSession(
    user: RequestUser,
    dto: CreateWorkoutSessionDto,
  ): Promise<WorkoutSessionView> {
    if (dto.workoutPlanId) {
      const plan = await this.getAccessiblePlan(dto.workoutPlanId, user);
      if (!plan) {
        throw new NotFoundException(
          `Workout plan ${dto.workoutPlanId} not found`,
        );
      }
    }

    const session = await this.prisma.workoutSession.create({
      data: {
        memberId: user.sub,
        workoutPlanId: dto.workoutPlanId ?? null,
        startTime: dto.startTime,
        notes: dto.notes ?? null,
        status: WorkoutSessionStatus.IN_PROGRESS,
      },
      include: this.sessionInclude(),
    });

    return this.mapWorkoutSession(session);
  }

  async completeWorkoutSession(
    id: string,
    user: RequestUser,
    dto: CompleteWorkoutSessionDto,
  ): Promise<WorkoutSessionView> {
    const session = await this.prisma.workoutSession.findUnique({
      where: { id },
      include: this.sessionInclude(),
    });

    if (!session) {
      throw new NotFoundException(`Workout session ${id} not found`);
    }

    if (session.memberId !== user.sub) {
      throw new ForbiddenException(
        'You can only complete your own workout sessions',
      );
    }

    if (dto.endTime < session.startTime) {
      throw new BadRequestException('Session end time must be after start time');
    }

    const updated = await this.prisma.workoutSession.update({
      where: { id },
      data: {
        endTime: dto.endTime,
        notes: dto.notes ?? session.notes,
        status: WorkoutSessionStatus.COMPLETED,
      },
      include: this.sessionInclude(),
    });

    return this.mapWorkoutSession(updated);
  }

  async listWorkoutSessions(user: RequestUser): Promise<WorkoutSessionView[]> {
    const sessions: WorkoutSessionView[] = [];
    const isTrainer = user.roles.includes(ERoleName.TRAINER);
    const isMember = user.roles.includes(ERoleName.MEMBER);

    if (isMember) {
      const memberSessions = await this.prisma.workoutSession.findMany({
        where: { memberId: user.sub },
        include: this.sessionInclude(),
        orderBy: [{ startTime: 'desc' }],
      });
      sessions.push(
        ...memberSessions.map((session) => this.mapWorkoutSession(session)),
      );
    }

    if (isTrainer) {
      const trainerPlans = await this.prisma.workoutPlan.findMany({
        where: { trainerId: user.sub },
        select: {
          id: true,
          assignments: {
            select: {
              memberId: true,
            },
          },
        },
      });

      const allowedMembersByPlan = new Map<string, Set<string>>();
      const planIds: string[] = [];

      for (const plan of trainerPlans) {
        planIds.push(plan.id);
        allowedMembersByPlan.set(
          plan.id,
          new Set(plan.assignments.map((assignment) => assignment.memberId)),
        );
      }

      if (planIds.length > 0) {
        const trainerSessions = await this.prisma.workoutSession.findMany({
          where: {
            workoutPlanId: { in: planIds },
          },
          include: this.sessionInclude(),
          orderBy: [{ startTime: 'desc' }],
        });

        sessions.push(
          ...trainerSessions
            .filter((session) => {
              if (!session.workoutPlanId) {
                return false;
              }

              const allowedMembers = allowedMembersByPlan.get(
                session.workoutPlanId,
              );
              return allowedMembers?.has(session.memberId) ?? false;
            })
            .map((session) => this.mapWorkoutSession(session)),
        );
      }
    }

    return this.uniqueSessionsById(sessions);
  }

  async createExerciseSetLog(
    sessionId: string,
    user: RequestUser,
    dto: CreateExerciseSetLogDto,
  ): Promise<WorkoutSessionSetLogView> {
    const session = await this.prisma.workoutSession.findUnique({
      where: { id: sessionId },
      include: {
        workoutPlan: {
          include: {
            planItems: {
              include: {
                exercise: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Workout session ${sessionId} not found`);
    }

    if (session.memberId !== user.sub) {
      throw new ForbiddenException(
        'You can only log sets for your own workout sessions',
      );
    }

    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Only in-progress sessions can receive set logs',
      );
    }

    await this.ensureExerciseExists(dto.exerciseId);

    if (dto.planItemId) {
      if (!session.workoutPlanId) {
        throw new BadRequestException(
          'Plan-linked sets cannot be logged against an unstructured session',
        );
      }

      const planItem = session.workoutPlan?.planItems.find(
        (item) => item.id === dto.planItemId,
      );

      if (!planItem) {
        throw new BadRequestException(
          'Plan item does not belong to the current session plan',
        );
      }
    }

    const created = await this.prisma.exerciseSetLog.create({
      data: {
        workoutSessionId: sessionId,
        exerciseId: dto.exerciseId,
        planItemId: dto.planItemId ?? null,
        setNumber: dto.setNumber,
        actualRep: dto.actualRep,
        actualWeight: dto.actualWeight,
        rpe: dto.rpe ?? null,
      },
      include: {
        exercise: true,
        planItem: {
          include: {
            exercise: true,
          },
        },
      },
    });

    return this.mapWorkoutSessionSetLog(created);
  }

  private ensureTrainer(user: RequestUser) {
    if (!user.roles.includes(ERoleName.TRAINER)) {
      throw new ForbiddenException('Trainer role required');
    }
  }

  private async ensureExerciseExists(id: string) {
    const exercise = await this.prisma.exercise.findUnique({ where: { id } });
    if (!exercise) {
      throw new NotFoundException(`Exercise ${id} not found`);
    }
    return exercise;
  }

  private async ensureExercisesExist(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      throw new BadRequestException('At least one exercise is required');
    }

    const found = await this.prisma.exercise.findMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
      select: {
        id: true,
      },
    });

    if (found.length !== uniqueIds.length) {
      throw new BadRequestException('One or more exercises do not exist');
    }
  }

  private async ensureAssignedMembersExist(memberIds: string[]) {
    const uniqueIds = [...new Set(memberIds)];
    if (uniqueIds.length === 0) {
      return;
    }

    const found = await this.prisma.user.findMany({
      where: {
        id: {
          in: uniqueIds,
        },
        userRole: {
          some: {
            role: {
              name: ERoleName.MEMBER,
            },
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (found.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more assigned members do not exist or are not members',
      );
    }
  }

  private async getAccessiblePlan(id: string, user: RequestUser) {
    const plan = await this.prisma.workoutPlan.findUnique({
      where: { id },
      include: {
        assignments: {
          select: {
            memberId: true,
          },
        },
      },
    });

    if (!plan) {
      return null;
    }

    const canAccess =
      plan.trainerId === user.sub ||
      plan.visibility === WorkoutPlanVisibility.PUBLIC ||
      (plan.visibility === WorkoutPlanVisibility.ASSIGNED &&
        plan.assignments.some((assignment) => assignment.memberId === user.sub));

    return canAccess ? plan : null;
  }

  private assertPlanAccess(
    plan: {
      trainerId: string;
      visibility: WorkoutPlanVisibility;
      assignments: { memberId: string }[];
    },
    user: RequestUser,
  ) {
    const canAccess =
      plan.trainerId === user.sub ||
      plan.visibility === WorkoutPlanVisibility.PUBLIC ||
      (plan.visibility === WorkoutPlanVisibility.ASSIGNED &&
        plan.assignments.some((assignment) => assignment.memberId === user.sub));

    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this workout plan');
    }
  }

  private mapPlanItemCreateInput(item: WorkoutPlanItemDto) {
    return {
      exerciseId: item.exerciseId,
      sequence: item.sequence,
      targetSet: item.targetSet ?? null,
      targetRep: item.targetRep ?? null,
      targetWeight: item.targetWeight ?? null,
      dayOfWeek: item.dayOfWeek ?? null,
      notes: item.notes ?? null,
    };
  }

  private planSummaryInclude() {
    return {
      planItems: {
        include: {
          exercise: true,
        },
        orderBy: [{ sequence: 'asc' as const }],
      },
    };
  }

  private planDetailInclude(includeAssignments: boolean) {
    return {
      trainer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      planItems: {
        include: {
          exercise: true,
        },
        orderBy: [{ sequence: 'asc' as const }],
      },
      ...(includeAssignments
        ? {
            assignments: {
              include: {
                member: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          }
        : {}),
    };
  }

  private sessionInclude() {
    return {
      workoutPlan: {
        select: {
          id: true,
          title: true,
          visibility: true,
          trainerId: true,
        },
      },
      setLogs: {
        include: {
          exercise: true,
          planItem: {
            include: {
              exercise: true,
            },
          },
        },
        orderBy: [{ setNumber: 'asc' as const }],
      },
    };
  }

  private mapExercise(exercise: any): ExerciseView {
    return {
      id: exercise.id,
      name: exercise.name,
      description: exercise.description,
      category: exercise.category,
      equipmentRequired: exercise.equipmentRequired,
      createdAt: exercise.createdAt,
      updatedAt: exercise.updatedAt ?? null,
    };
  }

  private mapWorkoutPlan(
    plan: any,
    includeAssignments = false,
  ): WorkoutPlanView {
    return {
      id: plan.id,
      trainerId: plan.trainerId,
      title: plan.title,
      duration: plan.duration ?? null,
      status: plan.status,
      visibility: plan.visibility,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt ?? null,
      trainer: plan.trainer
        ? {
            id: plan.trainer.id,
            firstName: plan.trainer.firstName,
            lastName: plan.trainer.lastName,
            email: plan.trainer.email,
          }
        : undefined,
      planItems: (plan.planItems ?? []).map((item: any) =>
        this.mapWorkoutPlanItem(item),
      ),
      ...(includeAssignments
        ? {
            assignments: (plan.assignments ?? []).map((assignment: any) => ({
              id: assignment.id,
              workoutPlanId: assignment.workoutPlanId,
              memberId: assignment.memberId,
              assignedAt: assignment.assignedAt,
              member: {
                id: assignment.member.id,
                firstName: assignment.member.firstName,
                lastName: assignment.member.lastName,
                email: assignment.member.email,
              },
            })),
          }
        : {}),
    };
  }

  private mapWorkoutPlanItem(item: any): WorkoutPlanItemView {
    return {
      id: item.id,
      workoutPlanId: item.workoutPlanId,
      exerciseId: item.exerciseId,
      sequence: item.sequence,
      targetSet: item.targetSet ?? null,
      targetRep: item.targetRep ?? null,
      targetWeight: item.targetWeight ?? null,
      dayOfWeek: item.dayOfWeek ?? null,
      notes: item.notes ?? null,
      exercise: this.mapExercise(item.exercise),
    };
  }

  private mapWorkoutSession(session: any): WorkoutSessionView {
    return {
      id: session.id,
      memberId: session.memberId,
      workoutPlanId: session.workoutPlanId ?? null,
      startTime: session.startTime,
      endTime: session.endTime ?? null,
      status: session.status,
      notes: session.notes ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt ?? null,
      workoutPlan: session.workoutPlan
        ? {
            id: session.workoutPlan.id,
            title: session.workoutPlan.title,
            visibility: session.workoutPlan.visibility,
            trainerId: session.workoutPlan.trainerId,
          }
        : null,
      setLogs: (session.setLogs ?? []).map((log: any) =>
        this.mapWorkoutSessionSetLog(log),
      ),
      isPlanDeleted: !session.workoutPlanId || !session.workoutPlan,
    };
  }

  private mapWorkoutSessionSetLog(log: any): WorkoutSessionSetLogView {
    const prescribedExercise = log.planItem?.exercise ?? null;
    const isSubstitution = !!log.planItem && log.exerciseId !== log.planItem.exerciseId;

    return {
      id: log.id,
      workoutSessionId: log.workoutSessionId,
      exerciseId: log.exerciseId,
      planItemId: log.planItemId ?? null,
      setNumber: log.setNumber,
      actualRep: log.actualRep,
      actualWeight: log.actualWeight,
      rpe: log.rpe ?? null,
      completedAt: log.completedAt,
      exercise: this.mapExercise(log.exercise),
      planItem: log.planItem ? this.mapWorkoutPlanItem(log.planItem) : null,
      prescribedExercise: prescribedExercise
        ? this.mapExercise(prescribedExercise)
        : null,
      isSubstitution,
    };
  }

  private uniquePlansById(plans: WorkoutPlanView[]) {
    const map = new Map<string, WorkoutPlanView>();
    for (const plan of plans) {
      map.set(plan.id, plan);
    }
    return [...map.values()];
  }

  private uniqueSessionsById(sessions: WorkoutSessionView[]) {
    const map = new Map<string, WorkoutSessionView>();
    for (const session of sessions) {
      map.set(session.id, session);
    }
    return [...map.values()];
  }

  private handlePrismaError(error: unknown, entity: string): never {
    if (this.isUniqueConflict(error)) {
      throw new ConflictException(`${entity} already exists`);
    }

    if (this.isForeignKeyConflict(error)) {
      throw new BadRequestException(
        `Unable to save ${entity.toLowerCase()} because of a related record`,
      );
    }

    throw error instanceof Error
      ? error
      : new Error(`Unexpected error while handling ${entity}`);
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isForeignKeyConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    );
  }
}
