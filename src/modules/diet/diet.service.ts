import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DietPlanAssignmentStatus,
  DietPlanStatus,
  DietPlanVisibility,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { TrainerService } from '../trainer/trainer.service';
import {
  CreateDietPlanAssignmentsDto,
  DietPlanAssignmentTerminalStatusDto,
  UpdateDietPlanAssignmentDto,
} from './dto/diet-plan-assignment.dto';
import {
  CreateDietPlanDto,
  DietPlanMealDto,
  UpdateDietPlanDto,
} from './dto/diet-plan.dto';
import { DietPlanQueryDto } from './dto/diet-plan-query.dto';

const dietPlanDetailInclude = Prisma.validator<Prisma.DietPlanInclude>()({
  trainer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  meals: {
    orderBy: [{ sequence: 'asc' as const }],
  },
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
    orderBy: [{ assignedAt: 'desc' as const }],
  },
});

type DietPlanRecord = Prisma.DietPlanGetPayload<{
  include: typeof dietPlanDetailInclude;
}>;
type DietPlanAssignmentRecord = DietPlanRecord['assignments'][number];
type DietPlanMealRecord = DietPlanRecord['meals'][number];
type DietPlanUserRecord = NonNullable<DietPlanRecord['trainer']>;

@Injectable()
export class DietService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainerService: TrainerService,
  ) {}

  async createDietPlan(user: RequestUser, dto: CreateDietPlanDto) {
    this.ensureTrainer(user);

    const plan = await this.prisma.dietPlan.create({
      data: {
        trainerId: user.sub,
        title: dto.title,
        description: dto.description ?? null,
        durationDays: dto.durationDays ?? null,
        calorieTarget: dto.calorieTarget ?? null,
        status: DietPlanStatus.DRAFT,
        visibility: DietPlanVisibility.PRIVATE,
        meals: {
          create: dto.meals.map((meal) => this.mapMealCreateInput(meal)),
        },
      },
      include: this.planDetailInclude(),
    });

    return this.mapTrainerPlanDetail(plan);
  }

  async listDietPlans(user: RequestUser, query: DietPlanQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const includeArchived = query.includeArchived ?? false;
    const skip = (page - 1) * limit;
    const isTrainer = user.roles.includes(ERoleName.TRAINER);
    const isMember = user.roles.includes(ERoleName.MEMBER);
    const isAdminOrStaff =
      user.roles.includes(ERoleName.ADMIN) || user.roles.includes(ERoleName.STAFF);

    const where = this.buildListWhere(user, query, includeArchived);
    const [plans, totalDocs] = await Promise.all([
      this.prisma.dietPlan.findMany({
        where,
        include: this.planDetailInclude(),
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.dietPlan.count({ where }),
    ]);

    return {
      docs: plans.map((plan) => {
        if (isTrainer && plan.trainerId === user.sub) {
          return this.mapTrainerPlanSummary(plan);
        }
        if (isMember) {
          return this.mapMemberPlan(plan, user.sub);
        }
        if (isAdminOrStaff) {
          return this.mapAdminPlan(plan);
        }
        return this.mapTrainerPlanSummary(plan);
      }),
      docsCount: plans.length,
      totalDocs,
      totalPages: Math.ceil(totalDocs / limit),
      currentPage: page,
      limit,
      hasNext: skip + plans.length < totalDocs,
      hasPrev: page > 1,
    };
  }

  async getDietPlan(id: string, user: RequestUser) {
    const plan = await this.prisma.dietPlan.findUnique({
      where: { id },
      include: this.planDetailInclude(),
    });

    if (!plan) {
      throw new NotFoundException(`Diet plan ${id} not found`);
    }

    if (user.roles.includes(ERoleName.TRAINER) && plan.trainerId === user.sub) {
      return this.mapTrainerPlanDetail(plan);
    }

    if (
      user.roles.includes(ERoleName.ADMIN) ||
      user.roles.includes(ERoleName.STAFF)
    ) {
      return this.mapAdminPlanDetail(plan);
    }

    if (user.roles.includes(ERoleName.MEMBER)) {
      const hasAccess = plan.assignments.some(
        (assignment: DietPlanAssignmentRecord) => assignment.memberId === user.sub,
      );
      if (!hasAccess) {
        throw new ForbiddenException('You do not have access to this diet plan');
      }
      return this.mapMemberPlan(plan, user.sub);
    }

    throw new ForbiddenException('You do not have access to this diet plan');
  }

  async updateDietPlan(id: string, user: RequestUser, dto: UpdateDietPlanDto) {
    this.ensureTrainer(user);
    const plan = await this.getOwnedPlanOrThrow(id, user.sub);

    if (plan.status === DietPlanStatus.ARCHIVED) {
      throw new BadRequestException('Archived diet plans are read-only');
    }

    if (this.hasEverAssignments(plan)) {
      throw new BadRequestException(
        'Diet plans become immutable after the first assignment',
      );
    }

    const nextStatus = dto.status ?? plan.status;
    this.assertNeverAssignedStatusTransition(plan.status, nextStatus);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.meals) {
        await tx.dietPlanMeal.deleteMany({
          where: { dietPlanId: id },
        });
      }

      return tx.dietPlan.update({
        where: { id },
        data: {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          durationDays: dto.durationDays ?? undefined,
          calorieTarget: dto.calorieTarget ?? undefined,
          status: nextStatus,
          meals: dto.meals
            ? {
                create: dto.meals.map((meal) => this.mapMealCreateInput(meal)),
              }
            : undefined,
        },
        include: this.planDetailInclude(),
      });
    });

    return this.mapTrainerPlanDetail(updated);
  }

  async createDietPlanAssignments(
    id: string,
    user: RequestUser,
    dto: CreateDietPlanAssignmentsDto,
  ) {
    this.ensureTrainer(user);
    const plan = await this.getOwnedPlanOrThrow(id, user.sub);

    if (plan.status !== DietPlanStatus.ACTIVE) {
      throw new BadRequestException('Only active diet plans can be assigned');
    }

    if (
      plan.visibility !== DietPlanVisibility.PRIVATE &&
      plan.visibility !== DietPlanVisibility.ASSIGNED
    ) {
      throw new BadRequestException('Diet plan is not in an assignable state');
    }

    const today = this.getTodayDateOnly();
    const uniqueAssignments = this.deduplicateAssignments(dto.assignments);
    await this.ensureMembersCanBeAssigned(plan.trainerId, uniqueAssignments, today);

    const memberIds = uniqueAssignments.map((assignment) => assignment.memberId);
    const effectiveDates = uniqueAssignments.map((assignment) => ({
      memberId: assignment.memberId,
      effectiveFrom: this.parseDateOnly(assignment.effectiveFrom),
      effectiveTo: assignment.effectiveTo
        ? this.parseDateOnly(assignment.effectiveTo)
        : null,
    }));

    await this.prisma.$transaction(async (tx) => {
      const existingAssignments = await tx.dietPlanAssignment.findMany({
        where: {
          dietPlanId: id,
          memberId: { in: memberIds },
          status: DietPlanAssignmentStatus.ACTIVE,
        },
        select: { memberId: true },
      });

      if (existingAssignments.length > 0) {
        throw new BadRequestException(
          'One or more members already have an active assignment for this plan',
        );
      }

      if (plan.visibility === DietPlanVisibility.PRIVATE) {
        await tx.dietPlan.update({
          where: { id },
          data: {
            status: DietPlanStatus.ACTIVE,
            visibility: DietPlanVisibility.ASSIGNED,
          },
        });
      }

      await tx.dietPlanAssignment.createMany({
        data: effectiveDates.map((assignment) => ({
          dietPlanId: id,
          memberId: assignment.memberId,
          effectiveFrom: assignment.effectiveFrom,
          effectiveTo: assignment.effectiveTo,
          status: DietPlanAssignmentStatus.ACTIVE,
        })),
      });
    });

    const updated = await this.prisma.dietPlan.findUnique({
      where: { id },
      include: this.planDetailInclude(),
    });

    return this.mapTrainerPlanDetail(this.assertPlanExists(updated, id));
  }

  async updateDietPlanAssignment(
    id: string,
    assignmentId: string,
    user: RequestUser,
    dto: UpdateDietPlanAssignmentDto,
  ) {
    this.ensureTrainer(user);
    const plan = await this.getOwnedPlanOrThrow(id, user.sub);
    const assignment = plan.assignments.find(
      (item: DietPlanAssignmentRecord) => item.id === assignmentId,
    );

    if (!assignment) {
      throw new NotFoundException(
        `Diet plan assignment ${assignmentId} not found for plan ${id}`,
      );
    }

    if (assignment.status !== DietPlanAssignmentStatus.ACTIVE) {
      throw new BadRequestException('Only active assignments can be updated');
    }

    const effectiveTo = dto.effectiveTo
      ? this.parseDateOnly(dto.effectiveTo)
      : this.getTodayDateOnly();

    if (effectiveTo < assignment.effectiveFrom) {
      throw new BadRequestException(
        'Assignment effectiveTo cannot be earlier than effectiveFrom',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.dietPlanAssignment.update({
        where: { id: assignmentId },
        data: {
          status:
            dto.status === DietPlanAssignmentTerminalStatusDto.ENDED
              ? DietPlanAssignmentStatus.ENDED
              : DietPlanAssignmentStatus.REMOVED,
          effectiveTo,
          endedAt: new Date(),
          endReason: dto.endReason ?? null,
        },
      });

      const remainingActiveAssignments = await tx.dietPlanAssignment.count({
        where: {
          dietPlanId: id,
          status: DietPlanAssignmentStatus.ACTIVE,
        },
      });

      if (remainingActiveAssignments === 0) {
        await tx.dietPlan.update({
          where: { id },
          data: {
            status: DietPlanStatus.ARCHIVED,
            visibility: DietPlanVisibility.ASSIGNED,
          },
        });
      }
    });

    const updated = await this.prisma.dietPlan.findUnique({
      where: { id },
      include: this.planDetailInclude(),
    });

    return this.mapTrainerPlanDetail(this.assertPlanExists(updated, id));
  }

  async archiveDietPlan(id: string, user: RequestUser) {
    this.ensureTrainer(user);
    const plan = await this.getOwnedPlanOrThrow(id, user.sub);

    if (plan.visibility !== DietPlanVisibility.PRIVATE) {
      throw new BadRequestException('Only private diet plans can be archived');
    }

    if (this.hasEverAssignments(plan)) {
      throw new BadRequestException(
        'Assigned diet plans are archived automatically when the last active assignment ends',
      );
    }

    const updated = await this.prisma.dietPlan.update({
      where: { id },
      data: {
        status: DietPlanStatus.ARCHIVED,
      },
      include: this.planDetailInclude(),
    });

    return this.mapTrainerPlanDetail(updated);
  }

  async deleteDietPlan(id: string, user: RequestUser) {
    this.ensureTrainer(user);
    const plan = await this.getOwnedPlanOrThrow(id, user.sub);

    if (
      plan.status !== DietPlanStatus.DRAFT ||
      plan.visibility !== DietPlanVisibility.PRIVATE
    ) {
      throw new BadRequestException(
        'Only never-assigned draft private diet plans can be deleted',
      );
    }

    if (this.hasEverAssignments(plan)) {
      throw new BadRequestException(
        'Assigned or previously assigned diet plans cannot be deleted',
      );
    }

    await this.prisma.dietPlan.delete({
      where: { id },
    });

    return { message: `Diet plan ${id} deleted successfully` };
  }

  async cloneDietPlan(id: string, user: RequestUser) {
    this.ensureTrainer(user);
    const plan = await this.getOwnedPlanOrThrow(id, user.sub);

    if (!this.hasEverAssignments(plan)) {
      throw new BadRequestException(
        'Only immutable assigned diet plans can be cloned',
      );
    }

    const clonedPlan = await this.prisma.$transaction(async (tx) => {
      return tx.dietPlan.create({
        data: {
          trainerId: user.sub,
          title: plan.title,
          description: plan.description,
          durationDays: plan.durationDays,
          calorieTarget: plan.calorieTarget,
          status: DietPlanStatus.DRAFT,
          visibility: DietPlanVisibility.PRIVATE,
          meals: {
            create: plan.meals.map((meal) => ({
              sequence: meal.sequence,
              mealType: meal.mealType,
              mealTitle: meal.mealTitle,
              scheduledTime: meal.scheduledTime,
              foodItemsText: meal.foodItemsText,
              calories: meal.calories,
              proteinGrams: meal.proteinGrams,
              carbsGrams: meal.carbsGrams,
              fatGrams: meal.fatGrams,
              notes: meal.notes,
            })),
          },
        },
        include: this.planDetailInclude(),
      });
    });

    return this.mapTrainerPlanDetail(clonedPlan);
  }

  private buildListWhere(
    user: RequestUser,
    query: DietPlanQueryDto,
    includeArchived: boolean,
  ): Prisma.DietPlanWhereInput {
    const statusFilter = query.status
      ? { status: query.status }
      : includeArchived
        ? {}
        : { status: { not: DietPlanStatus.ARCHIVED } };

    if (user.roles.includes(ERoleName.TRAINER)) {
      return {
        trainerId: user.sub,
        ...statusFilter,
      };
    }

    if (user.roles.includes(ERoleName.MEMBER)) {
      return {
        ...statusFilter,
        assignments: {
          some: {
            memberId: user.sub,
            ...(includeArchived
              ? {}
              : { status: DietPlanAssignmentStatus.ACTIVE }),
          },
        },
      };
    }

    if (
      user.roles.includes(ERoleName.ADMIN) ||
      user.roles.includes(ERoleName.STAFF)
    ) {
      return statusFilter;
    }

    throw new ForbiddenException('You do not have access to diet plans');
  }

  private async ensureMembersCanBeAssigned(
    trainerId: string,
    assignments: CreateDietPlanAssignmentsDto['assignments'],
    today: Date,
  ) {
    const memberIds = assignments.map((assignment) => assignment.memberId);
    const members = await this.prisma.user.findMany({
      where: {
        id: { in: memberIds },
        userRole: {
          some: {
            role: {
              name: ERoleName.MEMBER,
            },
          },
        },
      },
      select: { id: true },
    });

    if (members.length !== memberIds.length) {
      throw new BadRequestException(
        'One or more assignment targets do not exist or are not members',
      );
    }

    for (const assignment of assignments) {
      const effectiveFrom = this.parseDateOnly(assignment.effectiveFrom);
      if (effectiveFrom > today) {
        throw new BadRequestException(
          'Diet plan assignments cannot start in the future',
        );
      }

      if (assignment.effectiveTo) {
        const effectiveTo = this.parseDateOnly(assignment.effectiveTo);
        if (effectiveTo < effectiveFrom) {
          throw new BadRequestException(
            'Assignment effectiveTo cannot be earlier than effectiveFrom',
          );
        }
      }

      const link = await this.trainerService.findActiveTrainerClientLink(
        trainerId,
        assignment.memberId,
      );

      if (!link) {
        throw new BadRequestException(
          `Member ${assignment.memberId} does not have an active trainer-client link`,
        );
      }
    }
  }

  private deduplicateAssignments(
    assignments: CreateDietPlanAssignmentsDto['assignments'],
  ) {
    const uniqueAssignments = new Map<string, (typeof assignments)[number]>();

    for (const assignment of assignments) {
      if (uniqueAssignments.has(assignment.memberId)) {
        throw new BadRequestException(
          'Each member may appear only once per assignment request',
        );
      }
      uniqueAssignments.set(assignment.memberId, assignment);
    }

    return [...uniqueAssignments.values()];
  }

  private async getOwnedPlanOrThrow(id: string, trainerId: string) {
    const plan = await this.getPlanDetailOrThrow(id);

    if (plan.trainerId !== trainerId) {
      throw new ForbiddenException('You can only manage your own diet plans');
    }

    return plan;
  }

  private async getPlanDetailOrThrow(id: string): Promise<DietPlanRecord> {
    const plan = await this.prisma.dietPlan.findUnique({
      where: { id },
      include: this.planDetailInclude(),
    });

    return this.assertPlanExists(plan, id);
  }

  private assertPlanExists(
    plan: DietPlanRecord | null,
    id: string,
  ): DietPlanRecord {
    if (!plan) {
      throw new NotFoundException(`Diet plan ${id} not found`);
    }

    return plan;
  }

  private assertNeverAssignedStatusTransition(
    currentStatus: DietPlanStatus,
    nextStatus: DietPlanStatus,
  ) {
    if (currentStatus === DietPlanStatus.DRAFT) {
      if (
        nextStatus !== DietPlanStatus.DRAFT &&
        nextStatus !== DietPlanStatus.ACTIVE
      ) {
        throw new BadRequestException(
          'Draft diet plans can only remain draft or become active',
        );
      }
      return;
    }

    if (currentStatus === DietPlanStatus.ACTIVE) {
      if (
        nextStatus !== DietPlanStatus.DRAFT &&
        nextStatus !== DietPlanStatus.ACTIVE &&
        nextStatus !== DietPlanStatus.ARCHIVED
      ) {
        throw new BadRequestException(
          'Active private diet plans can only move to draft, remain active, or be archived',
        );
      }
      return;
    }

    throw new BadRequestException('Archived diet plans cannot be modified');
  }

  private mapMealCreateInput(meal: DietPlanMealDto) {
    return {
      sequence: meal.sequence,
      mealType: meal.mealType,
      mealTitle: meal.mealTitle,
      scheduledTime: meal.scheduledTime
        ? this.parseTimeOnly(meal.scheduledTime)
        : null,
      foodItemsText: meal.foodItemsText ?? null,
      calories: meal.calories,
      proteinGrams: meal.proteinGrams ?? null,
      carbsGrams: meal.carbsGrams ?? null,
      fatGrams: meal.fatGrams ?? null,
      notes: meal.notes ?? null,
    };
  }

  private mapTrainerPlanSummary(plan: DietPlanRecord) {
    return {
      id: plan.id,
      trainerId: plan.trainerId,
      title: plan.title,
      description: plan.description ?? null,
      durationDays: plan.durationDays ?? null,
      calorieTarget: plan.calorieTarget ?? null,
      status: plan.status,
      visibility: plan.visibility,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt ?? null,
      assignmentCounts: this.mapAssignmentCounts(plan.assignments),
      meals: this.mapMeals(plan.meals),
    };
  }

  private mapTrainerPlanDetail(plan: DietPlanRecord) {
    return {
      ...this.mapTrainerPlanSummary(plan),
      trainer: this.mapTrainer(plan.trainer),
      assignments: plan.assignments.map((assignment: DietPlanAssignmentRecord) =>
        this.mapAssignment(assignment),
      ),
    };
  }

  private mapMemberPlan(plan: DietPlanRecord, memberId: string) {
    return {
      id: plan.id,
      trainerId: plan.trainerId,
      title: plan.title,
      description: plan.description ?? null,
      durationDays: plan.durationDays ?? null,
      calorieTarget: plan.calorieTarget ?? null,
      status: plan.status,
      visibility: plan.visibility,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt ?? null,
      trainer: this.mapTrainer(plan.trainer),
      meals: this.mapMeals(plan.meals),
      assignments: plan.assignments
        .filter(
          (assignment: DietPlanAssignmentRecord) => assignment.memberId === memberId,
        )
        .map((assignment: DietPlanAssignmentRecord) => this.mapAssignment(assignment)),
    };
  }

  private mapAdminPlan(plan: DietPlanRecord) {
    return {
      id: plan.id,
      trainerId: plan.trainerId,
      title: plan.title,
      description: plan.description ?? null,
      durationDays: plan.durationDays ?? null,
      calorieTarget: plan.calorieTarget ?? null,
      status: plan.status,
      visibility: plan.visibility,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt ?? null,
      trainer: this.mapTrainer(plan.trainer),
      assignmentCounts: this.mapAssignmentCounts(plan.assignments),
    };
  }

  private mapAdminPlanDetail(plan: DietPlanRecord) {
    return {
      ...this.mapAdminPlan(plan),
      meals: this.mapMeals(plan.meals),
    };
  }

  private mapMeals(meals: DietPlanMealRecord[]) {
    return meals.map((meal) => ({
      id: meal.id,
      dietPlanId: meal.dietPlanId,
      sequence: meal.sequence,
      mealType: meal.mealType,
      mealTitle: meal.mealTitle,
      scheduledTime: meal.scheduledTime
        ? this.formatTimeOnly(meal.scheduledTime)
        : null,
      foodItemsText: meal.foodItemsText ?? null,
      calories: meal.calories,
      proteinGrams: this.toNumber(meal.proteinGrams),
      carbsGrams: this.toNumber(meal.carbsGrams),
      fatGrams: this.toNumber(meal.fatGrams),
      notes: meal.notes ?? null,
      createdAt: meal.createdAt,
      updatedAt: meal.updatedAt ?? null,
    }));
  }

  private mapAssignment(assignment: DietPlanAssignmentRecord) {
    return {
      id: assignment.id,
      dietPlanId: assignment.dietPlanId,
      memberId: assignment.memberId,
      effectiveFrom: this.formatDateOnly(assignment.effectiveFrom),
      effectiveTo: assignment.effectiveTo
        ? this.formatDateOnly(assignment.effectiveTo)
        : null,
      status: assignment.status,
      assignedAt: assignment.assignedAt,
      endedAt: assignment.endedAt ?? null,
      endReason: assignment.endReason ?? null,
      member: assignment.member ? this.mapTrainer(assignment.member) : undefined,
    };
  }

  private mapTrainer(trainer: DietPlanUserRecord) {
    return {
      id: trainer.id,
      firstName: trainer.firstName,
      lastName: trainer.lastName,
      email: trainer.email,
    };
  }

  private mapAssignmentCounts(assignments: DietPlanAssignmentRecord[]) {
    return {
      total: assignments.length,
      active: assignments.filter(
        (assignment) => assignment.status === DietPlanAssignmentStatus.ACTIVE,
      ).length,
      historical: assignments.filter(
        (assignment) => assignment.status !== DietPlanAssignmentStatus.ACTIVE,
      ).length,
    };
  }

  private hasEverAssignments(plan: DietPlanRecord) {
    return plan.assignments.length > 0;
  }

  private ensureTrainer(user: RequestUser) {
    if (!user.roles.includes(ERoleName.TRAINER)) {
      throw new ForbiddenException('Trainer role required');
    }
  }

  private parseDateOnly(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private parseTimeOnly(value: string) {
    return new Date(`1970-01-01T${value}.000Z`);
  }

  private getTodayDateOnly() {
    return this.parseDateOnly(new Date().toISOString().slice(0, 10));
  }

  private formatDateOnly(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private formatTimeOnly(value: Date) {
    return value.toISOString().slice(11, 19);
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined) {
    return value === null || value === undefined ? null : Number(value);
  }

  private planDetailInclude() {
    return dietPlanDetailInclude;
  }
}
