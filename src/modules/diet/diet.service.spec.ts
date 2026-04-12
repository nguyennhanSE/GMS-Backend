import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DietPlanAssignmentStatus,
  DietPlanStatus,
  DietPlanVisibility,
} from '@prisma/client';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { ERoleName } from '../roles/enums/role.enum';
import { TrainerService } from '../trainer/trainer.service';
import { DietService } from './diet.service';
import { CreateDietPlanDto, UpdateDietPlanDto } from './dto/diet-plan.dto';
import {
  CreateDietPlanAssignmentsDto,
  UpdateDietPlanAssignmentDto,
} from './dto/diet-plan-assignment.dto';

describe('DietService', () => {
  let service: DietService;
  let prisma: {
    dietPlan: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    dietPlanMeal: {
      deleteMany: jest.Mock;
    };
    dietPlanAssignment: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    user: {
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let trainerService: {
    findActiveTrainerClientLink: jest.Mock;
  };

  const trainerUser: RequestUser = {
    sub: 'trainer-1',
    email: 'trainer@test.local',
    tokenType: 'access',
    roles: [ERoleName.TRAINER],
  };

  const memberUser = {
    id: 'member-1',
    firstName: 'Test',
    lastName: 'Member',
    email: 'member@test.local',
  };

  const trainer = {
    id: trainerUser.sub,
    firstName: 'Coach',
    lastName: 'Trainer',
    email: trainerUser.email,
  };

  const baseMeal = {
    id: 'meal-1',
    dietPlanId: 'plan-1',
    sequence: 1,
    mealType: 'BREAKFAST',
    mealTitle: 'Breakfast',
    scheduledTime: new Date('1970-01-01T07:30:00.000Z'),
    foodItemsText: 'Oats, eggs',
    calories: 520,
    proteinGrams: '35.00',
    carbsGrams: '55.00',
    fatGrams: '18.00',
    notes: 'Hydrate first',
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    updatedAt: null,
  };

  const assignment = {
    id: 'assignment-1',
    dietPlanId: 'plan-1',
    memberId: memberUser.id,
    effectiveFrom: new Date('2026-03-24T00:00:00.000Z'),
    effectiveTo: null,
    status: DietPlanAssignmentStatus.ACTIVE,
    assignedAt: new Date('2026-03-24T00:00:00.000Z'),
    endedAt: null,
    endReason: null,
    member: {
      ...memberUser,
    },
  };

  function buildPlan(overrides: Partial<any> = {}) {
    return {
      id: 'plan-1',
      trainerId: trainerUser.sub,
      title: 'Lean Bulk Daily Plan',
      description: 'High-protein daily plan',
      durationDays: 30,
      calorieTarget: 2400,
      status: DietPlanStatus.DRAFT,
      visibility: DietPlanVisibility.PRIVATE,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: null,
      trainer,
      meals: [baseMeal],
      assignments: [],
      ...overrides,
    };
  }

  function makeTransactionClient() {
    return {
      dietPlan: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
      dietPlanMeal: {
        deleteMany: jest.fn(),
      },
      dietPlanAssignment: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };
  }

  beforeEach(() => {
    prisma = {
      dietPlan: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      dietPlanMeal: {
        deleteMany: jest.fn(),
      },
      dietPlanAssignment: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    trainerService = {
      findActiveTrainerClientLink: jest.fn(),
    };

    service = new DietService(
      prisma as unknown as PrismaService,
      trainerService as unknown as TrainerService,
    );
  });

  it('creates a draft private plan with nested meals', async () => {
    const plan = buildPlan();
    prisma.dietPlan.create.mockResolvedValue(plan);

    const dto: CreateDietPlanDto = {
      title: 'Lean Bulk Daily Plan',
      description: 'High-protein daily plan',
      durationDays: 30,
      calorieTarget: 2400,
      meals: [
        {
          sequence: 1,
          mealType: 'BREAKFAST' as any,
          mealTitle: 'Breakfast',
          scheduledTime: '07:30:00',
          foodItemsText: 'Oats, eggs',
          calories: 520,
          proteinGrams: 35,
          carbsGrams: 55,
          fatGrams: 18,
          notes: 'Hydrate first',
        },
      ],
    };

    const result = await service.createDietPlan(trainerUser, dto);

    expect(prisma.dietPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trainerId: trainerUser.sub,
          status: DietPlanStatus.DRAFT,
          visibility: DietPlanVisibility.PRIVATE,
          meals: {
            create: [
              expect.objectContaining({
                sequence: 1,
                mealTitle: 'Breakfast',
                calories: 520,
              }),
            ],
          },
        }),
      }),
    );
    expect(result.status).toBe(DietPlanStatus.DRAFT);
    expect(result.visibility).toBe(DietPlanVisibility.PRIVATE);
    expect(result.meals).toHaveLength(1);
    expect(result.assignmentCounts.total).toBe(0);
  });

  it('activates a never-assigned plan through patch', async () => {
    const plan = buildPlan({
      status: DietPlanStatus.DRAFT,
      assignments: [],
    });
    const updatedPlan = buildPlan({
      status: DietPlanStatus.ACTIVE,
      assignments: [],
      title: 'Lean Bulk Daily Plan v2',
    });

    let currentPlan = plan;
    const tx = makeTransactionClient();
    tx.dietPlan.update.mockImplementation(() => {
      currentPlan = updatedPlan;
      return updatedPlan;
    });
    prisma.dietPlan.findUnique.mockImplementation(() => currentPlan);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    const result = await service.updateDietPlan('plan-1', trainerUser, {
      status: DietPlanStatus.ACTIVE,
      title: 'Lean Bulk Daily Plan v2',
    } as UpdateDietPlanDto);

    expect(result.status).toBe(DietPlanStatus.ACTIVE);
    expect(result.title).toBe('Lean Bulk Daily Plan v2');
  });

  it('rejects direct patch into assigned behavior', async () => {
    prisma.dietPlan.findUnique.mockResolvedValue(buildPlan());

    await expect(
      service.updateDietPlan('plan-1', trainerUser, {
        status: 'ASSIGNED' as any,
      } as UpdateDietPlanDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows edits while a plan is never-assigned and draft/private', async () => {
    const plan = buildPlan();
    const updatedPlan = buildPlan({
      title: 'Lean Bulk Daily Plan Updated',
      meals: [
        {
          ...baseMeal,
          id: 'meal-2',
          mealTitle: 'Updated Breakfast',
        },
      ],
    });

    let currentPlan = plan;
    const tx = makeTransactionClient();
    tx.dietPlan.update.mockImplementation(() => {
      currentPlan = updatedPlan;
      return updatedPlan;
    });
    prisma.dietPlan.findUnique.mockImplementation(() => currentPlan);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    const result = await service.updateDietPlan('plan-1', trainerUser, {
      title: 'Lean Bulk Daily Plan Updated',
      meals: [
        {
          sequence: 1,
          mealType: 'BREAKFAST' as any,
          mealTitle: 'Updated Breakfast',
          calories: 540,
        },
      ],
    } as UpdateDietPlanDto);

    expect(result.title).toBe('Lean Bulk Daily Plan Updated');
    expect(result.meals[0].mealTitle).toBe('Updated Breakfast');
  });

  it('rejects in-place edits after the first assignment', async () => {
    prisma.dietPlan.findUnique.mockResolvedValue(
      buildPlan({
        status: DietPlanStatus.ACTIVE,
        visibility: DietPlanVisibility.ASSIGNED,
        assignments: [assignment],
      }),
    );

    await expect(
      service.updateDietPlan('plan-1', trainerUser, {
        title: 'Attempted rewrite',
      } as UpdateDietPlanDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bootsraps the first assignment and promotes the plan to active assigned', async () => {
    const plan = buildPlan({ status: DietPlanStatus.ACTIVE, assignments: [] });
    const updatedPlan = buildPlan({
      status: DietPlanStatus.ACTIVE,
      visibility: DietPlanVisibility.ASSIGNED,
      assignments: [assignment],
    });
    const tx = makeTransactionClient();
    tx.dietPlan.update.mockResolvedValue(updatedPlan);
    tx.dietPlanAssignment.findMany.mockResolvedValue([]);

    prisma.dietPlan.findUnique
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(updatedPlan);
    prisma.user.findMany.mockResolvedValue([{ id: memberUser.id }]);
    prisma.$transaction.mockImplementation((callback: any) =>
      callback(tx),
    );
    trainerService.findActiveTrainerClientLink.mockResolvedValue({
      id: 'link-1',
    });

    const dto: CreateDietPlanAssignmentsDto = {
      assignments: [
        {
          memberId: memberUser.id,
          effectiveFrom: '2026-03-24',
        },
      ],
    };

    const result = await service.createDietPlanAssignments(
      'plan-1',
      trainerUser,
      dto,
    );

    expect(tx.dietPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DietPlanStatus.ACTIVE,
          visibility: DietPlanVisibility.ASSIGNED,
        }),
      }),
    );
    expect(tx.dietPlanAssignment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            memberId: memberUser.id,
            status: DietPlanAssignmentStatus.ACTIVE,
          }),
        ],
      }),
    );
    expect(result.visibility).toBe(DietPlanVisibility.ASSIGNED);
    expect(result.assignments).toHaveLength(1);
  });

  it('rejects assignment without an active trainer-client link', async () => {
    prisma.dietPlan.findUnique.mockResolvedValue(
      buildPlan({ status: DietPlanStatus.ACTIVE }),
    );
    prisma.user.findMany.mockResolvedValue([{ id: memberUser.id }]);
    trainerService.findActiveTrainerClientLink.mockResolvedValue(null);

    await expect(
      service.createDietPlanAssignments('plan-1', trainerUser, {
        assignments: [
          {
            memberId: memberUser.id,
            effectiveFrom: '2026-03-24',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects future-dated effectiveFrom values', async () => {
    prisma.dietPlan.findUnique.mockResolvedValue(
      buildPlan({ status: DietPlanStatus.ACTIVE }),
    );
    prisma.user.findMany.mockResolvedValue([{ id: memberUser.id }]);

    await expect(
      service.createDietPlanAssignments('plan-1', trainerUser, {
        assignments: [
          {
            memberId: memberUser.id,
            effectiveFrom: '2099-01-01',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(trainerService.findActiveTrainerClientLink).not.toHaveBeenCalled();
  });

  it('clones an immutable assigned plan into a draft private successor', async () => {
    const sourcePlan = buildPlan({
      status: DietPlanStatus.ARCHIVED,
      visibility: DietPlanVisibility.ASSIGNED,
      assignments: [assignment],
    });
    const clonedPlan = buildPlan({
      id: 'plan-2',
      status: DietPlanStatus.DRAFT,
      visibility: DietPlanVisibility.PRIVATE,
      assignments: [],
    });
    const tx = makeTransactionClient();
    tx.dietPlan.create.mockResolvedValue(clonedPlan);
    prisma.dietPlan.findUnique.mockResolvedValue(sourcePlan);
    prisma.$transaction.mockImplementation((callback: any) =>
      callback(tx),
    );

    const result = await service.cloneDietPlan('plan-1', trainerUser);

    expect(tx.dietPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DietPlanStatus.DRAFT,
          visibility: DietPlanVisibility.PRIVATE,
          meals: {
            create: expect.arrayContaining([
              expect.objectContaining({
                mealTitle: baseMeal.mealTitle,
              }),
            ]),
          },
        }),
      }),
    );
    expect(result.status).toBe(DietPlanStatus.DRAFT);
    expect(result.visibility).toBe(DietPlanVisibility.PRIVATE);
    expect(result.assignments).toHaveLength(0);
  });

  it('archives the plan automatically when the last assignment ends', async () => {
    const plan = buildPlan({
      status: DietPlanStatus.ACTIVE,
      visibility: DietPlanVisibility.ASSIGNED,
      assignments: [assignment],
    });
    const archivedPlan = buildPlan({
      status: DietPlanStatus.ARCHIVED,
      visibility: DietPlanVisibility.ASSIGNED,
      assignments: [
        {
          ...assignment,
          status: DietPlanAssignmentStatus.ENDED,
          endedAt: new Date('2026-03-26T00:00:00.000Z'),
          effectiveTo: new Date('2026-03-26T00:00:00.000Z'),
        },
      ],
    });
    const tx = makeTransactionClient();
    tx.dietPlanAssignment.update.mockResolvedValue({
      ...assignment,
      status: DietPlanAssignmentStatus.ENDED,
    });
    tx.dietPlanAssignment.count.mockResolvedValue(0);
    tx.dietPlan.update.mockResolvedValue(archivedPlan);
    prisma.dietPlan.findUnique
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(archivedPlan);
    prisma.$transaction.mockImplementation((callback: any) =>
      callback(tx),
    );

    const result = await service.updateDietPlanAssignment(
      'plan-1',
      'assignment-1',
      trainerUser,
      {
        status: 'ENDED',
        effectiveTo: '2026-03-26',
        endReason: 'Completed',
      } as UpdateDietPlanAssignmentDto,
    );

    expect(tx.dietPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DietPlanStatus.ARCHIVED,
          visibility: DietPlanVisibility.ASSIGNED,
        }),
      }),
    );
    expect(result.status).toBe(DietPlanStatus.ARCHIVED);
  });

  it('rejects archive when assignments still exist', async () => {
    prisma.dietPlan.findUnique.mockResolvedValue(
      buildPlan({
        status: DietPlanStatus.ACTIVE,
        visibility: DietPlanVisibility.PRIVATE,
        assignments: [assignment],
      }),
    );

    await expect(
      service.archiveDietPlan('plan-1', trainerUser),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-trainers from write operations', async () => {
    const member: RequestUser = {
      sub: memberUser.id,
      email: memberUser.email,
      tokenType: 'access',
      roles: [ERoleName.MEMBER],
    };

    await expect(
      service.createDietPlan(member, {
        title: 'Unauthorized',
        meals: [],
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
