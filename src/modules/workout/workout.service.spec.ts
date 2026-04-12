import { ForbiddenException } from '@nestjs/common';
import {
  DayOfWeek,
  WorkoutPlanStatus,
  WorkoutPlanVisibility,
  WorkoutSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import {
  CreateExerciseSetLogDto,
} from './dto/exercise-set-log.dto';
import { CreateWorkoutPlanDto, WorkoutPlanStatusDto, WorkoutPlanVisibilityDto } from './dto/workout-plan.dto';
import { WorkoutService } from './workout.service';
import { AppCacheService } from '../../libs/cache/cache.service';

describe('WorkoutService', () => {
  let service: WorkoutService;
  let prisma: {
    exercise: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    user: {
      findMany: jest.Mock;
    };
    workoutPlan: {
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
    workoutSession: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    exerciseSetLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let appCacheService: {
    remember: jest.Mock;
    invalidateTags: jest.Mock;
  };

  const trainerUser: RequestUser = {
    sub: 'trainer-1',
    email: 'trainer@test.local',
    tokenType: 'access',
    roles: [ERoleName.TRAINER],
  };

  const memberUser: RequestUser = {
    sub: 'member-1',
    email: 'member@test.local',
    tokenType: 'access',
    roles: [ERoleName.MEMBER],
  };

  const otherMemberUser: RequestUser = {
    sub: 'member-2',
    email: 'other-member@test.local',
    tokenType: 'access',
    roles: [ERoleName.MEMBER],
  };

  beforeEach(() => {
    prisma = {
      exercise: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      workoutPlan: {
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      workoutSession: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      exerciseSetLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    appCacheService = {
      remember: jest.fn(),
      invalidateTags: jest.fn().mockResolvedValue(undefined),
    };

    service = new WorkoutService(
      prisma as unknown as PrismaService,
      appCacheService as unknown as AppCacheService,
    );
  });

  it('loads exercises through the shared cache service', async () => {
    const exercises = [
      {
        id: 'exercise-1',
        name: 'Back Squat',
        description: null,
        category: 'Strength',
        equipmentRequired: 'Barbell',
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
        updatedAt: null,
      },
    ];

    prisma.exercise.findMany.mockResolvedValue(exercises);
    appCacheService.remember.mockImplementation(
      async (_key: string, loader: () => Promise<unknown>) => loader(),
    );

    const result = await service.listExercises();

    expect(appCacheService.remember).toHaveBeenCalled();
    expect(result).toEqual(exercises);
  });

  it('invalidates the exercise catalog cache after creating an exercise', async () => {
    const createdExercise = {
      id: 'exercise-1',
      name: 'Back Squat',
      description: null,
      category: 'Strength',
      equipmentRequired: 'Barbell',
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: null,
    };

    prisma.exercise.create.mockResolvedValue(createdExercise);

    const result = await service.createExercise({
      name: 'Back Squat',
      category: 'Strength',
      equipmentRequired: 'Barbell',
    } as any);

    expect(prisma.exercise.create).toHaveBeenCalled();
    expect(appCacheService.invalidateTags).toHaveBeenCalledWith([
      'workout:exercises',
    ]);
    expect(result).toEqual(createdExercise);
  });

  it('creates a workout plan with nested items and deduplicated assignments', async () => {
    const prescribedExerciseId = '11111111-1111-4111-8111-111111111111';
    const assignedMemberA = '33333333-3333-4333-8333-333333333333';
    const assignedMemberB = '44444444-4444-4444-8444-444444444444';

    prisma.exercise.findMany.mockResolvedValue([{ id: prescribedExerciseId }]);
    prisma.user.findMany.mockResolvedValue([
      { id: assignedMemberA },
      { id: assignedMemberB },
    ]);

    const transactionCreate = jest.fn().mockResolvedValue({
      id: 'plan-1',
      trainerId: trainerUser.sub,
      title: 'Lower Body Strength',
      duration: 60,
      status: WorkoutPlanStatus.ACTIVE,
      visibility: WorkoutPlanVisibility.ASSIGNED,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: null,
      trainer: {
        id: trainerUser.sub,
        firstName: 'Coach',
        lastName: 'Trainer',
        email: trainerUser.email,
      },
      planItems: [
        {
          id: 'plan-item-1',
          workoutPlanId: 'plan-1',
          exerciseId: prescribedExerciseId,
          sequence: 1,
          targetSet: 4,
          targetRep: 5,
          targetWeight: 100,
          dayOfWeek: DayOfWeek.MON,
          notes: 'Primary strength work',
          exercise: {
            id: prescribedExerciseId,
            name: 'Back Squat',
            description: 'Compound lower-body movement',
            category: 'Strength',
            equipmentRequired: 'Barbell',
            createdAt: new Date('2026-03-24T00:00:00.000Z'),
            updatedAt: null,
          },
        },
      ],
      assignments: [
        {
          id: 'assignment-1',
          workoutPlanId: 'plan-1',
          memberId: assignedMemberA,
          assignedAt: new Date('2026-03-24T00:00:00.000Z'),
          member: {
            id: assignedMemberA,
            firstName: 'Test',
            lastName: 'Member A',
            email: 'member-a@test.local',
          },
        },
        {
          id: 'assignment-2',
          workoutPlanId: 'plan-1',
          memberId: assignedMemberB,
          assignedAt: new Date('2026-03-24T00:00:00.000Z'),
          member: {
            id: assignedMemberB,
            firstName: 'Test',
            lastName: 'Member B',
            email: 'member-b@test.local',
          },
        },
      ],
    });

    prisma.$transaction.mockImplementation((callback: any) =>
      callback({
        workoutPlan: {
          create: transactionCreate,
        },
      }),
    );

    const dto: CreateWorkoutPlanDto = {
      title: 'Lower Body Strength',
      duration: 60,
      status: WorkoutPlanStatusDto.ACTIVE,
      visibility: WorkoutPlanVisibilityDto.ASSIGNED,
      assignedMemberIds: [assignedMemberA, assignedMemberA, assignedMemberB],
      planItems: [
        {
          exerciseId: prescribedExerciseId,
          sequence: 1,
          targetSet: 4,
          targetRep: 5,
          targetWeight: 100,
          dayOfWeek: DayOfWeek.MON,
          notes: 'Primary strength work',
        },
      ],
    };

    const result = await service.createWorkoutPlan(trainerUser, dto);

    expect(prisma.exercise.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [prescribedExerciseId],
        },
      },
      select: {
        id: true,
      },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [assignedMemberA, assignedMemberB],
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
    expect(transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trainerId: trainerUser.sub,
          title: dto.title,
          duration: dto.duration,
          status: WorkoutPlanStatus.ACTIVE,
          visibility: WorkoutPlanVisibility.ASSIGNED,
          planItems: {
            create: [
              expect.objectContaining({
                exerciseId: prescribedExerciseId,
                sequence: 1,
                targetSet: 4,
                targetRep: 5,
                targetWeight: 100,
                dayOfWeek: DayOfWeek.MON,
                notes: 'Primary strength work',
              }),
            ],
          },
          assignments: {
            create: [
              { memberId: assignedMemberA },
              { memberId: assignedMemberB },
            ],
          },
        }),
      }),
    );
    expect(result.id).toBe('plan-1');
    expect(result.planItems).toHaveLength(1);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments?.map((item) => item.memberId)).toEqual([
      assignedMemberA,
      assignedMemberB,
    ]);
  });

  it('rejects plan creation for non-trainers', async () => {
    await expect(
      service.createWorkoutPlan(memberUser, {
        title: 'Unauthorized Plan',
        duration: 45,
        planItems: [
          {
            exerciseId: '11111111-1111-4111-8111-111111111111',
            sequence: 1,
            targetSet: 3,
            targetRep: 8,
            targetWeight: 80,
          },
        ],
      } as CreateWorkoutPlanDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unrelated members from reading a private workout plan', async () => {
    prisma.workoutPlan.findUnique.mockResolvedValue({
      id: 'plan-1',
      trainerId: trainerUser.sub,
      title: 'Private Plan',
      duration: 60,
      status: WorkoutPlanStatus.DRAFT,
      visibility: WorkoutPlanVisibility.PRIVATE,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: null,
      trainer: {
        id: trainerUser.sub,
        firstName: 'Coach',
        lastName: 'Trainer',
        email: trainerUser.email,
      },
      assignments: [],
      planItems: [],
    });

    await expect(service.getWorkoutPlan('plan-1', memberUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects cross-user set logging before saving the set', async () => {
    prisma.workoutSession.findUnique.mockResolvedValue({
      id: 'session-1',
      memberId: otherMemberUser.sub,
      workoutPlanId: 'plan-1',
      startTime: new Date('2026-03-24T08:00:00.000Z'),
      endTime: null,
      status: WorkoutSessionStatus.IN_PROGRESS,
      notes: null,
      createdAt: new Date('2026-03-24T08:00:00.000Z'),
      updatedAt: null,
      workoutPlan: {
        id: 'plan-1',
        title: 'Assigned Plan',
        visibility: WorkoutPlanVisibility.ASSIGNED,
        trainerId: trainerUser.sub,
        planItems: [
          {
            id: 'plan-item-1',
            workoutPlanId: 'plan-1',
            exerciseId: '11111111-1111-4111-8111-111111111111',
            sequence: 1,
            targetSet: 3,
            targetRep: 5,
            targetWeight: 100,
            dayOfWeek: DayOfWeek.MON,
            notes: null,
            exercise: {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Back Squat',
              description: null,
              category: 'Strength',
              equipmentRequired: 'Barbell',
              createdAt: new Date('2026-03-24T00:00:00.000Z'),
              updatedAt: null,
            },
          },
        ],
      },
      setLogs: [],
    });

    await expect(
      service.createExerciseSetLog('session-1', memberUser, {
        exerciseId: '11111111-1111-4111-8111-111111111111',
        planItemId: 'plan-item-1',
        setNumber: 1,
        actualRep: 5,
        actualWeight: 100,
        rpe: 8,
      } as CreateExerciseSetLogDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('flags substituted sets when the performed exercise differs from the prescribed one', async () => {
    const prescribedExerciseId = '11111111-1111-4111-8111-111111111111';
    const substituteExerciseId = '22222222-2222-4222-8222-222222222222';

    prisma.workoutSession.findUnique.mockResolvedValue({
      id: 'session-1',
      memberId: memberUser.sub,
      workoutPlanId: 'plan-1',
      startTime: new Date('2026-03-24T08:00:00.000Z'),
      endTime: null,
      status: WorkoutSessionStatus.IN_PROGRESS,
      notes: null,
      createdAt: new Date('2026-03-24T08:00:00.000Z'),
      updatedAt: null,
      workoutPlan: {
        id: 'plan-1',
        title: 'Assigned Plan',
        visibility: WorkoutPlanVisibility.ASSIGNED,
        trainerId: trainerUser.sub,
        planItems: [
          {
            id: 'plan-item-1',
            workoutPlanId: 'plan-1',
            exerciseId: prescribedExerciseId,
            sequence: 1,
            targetSet: 3,
            targetRep: 5,
            targetWeight: 100,
            dayOfWeek: DayOfWeek.MON,
            notes: null,
            exercise: {
              id: prescribedExerciseId,
              name: 'Back Squat',
              description: null,
              category: 'Strength',
              equipmentRequired: 'Barbell',
              createdAt: new Date('2026-03-24T00:00:00.000Z'),
              updatedAt: null,
            },
          },
        ],
      },
      setLogs: [],
    });
    prisma.exercise.findUnique.mockResolvedValue({
      id: substituteExerciseId,
      name: 'Hack Squat',
      description: null,
      category: 'Strength',
      equipmentRequired: 'Machine',
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: null,
    });
    prisma.exerciseSetLog.create.mockResolvedValue({
      id: 'set-log-1',
      workoutSessionId: 'session-1',
      exerciseId: substituteExerciseId,
      planItemId: 'plan-item-1',
      setNumber: 1,
      actualRep: 8,
      actualWeight: 90,
      rpe: 7,
      completedAt: new Date('2026-03-24T08:10:00.000Z'),
      exercise: {
        id: substituteExerciseId,
        name: 'Hack Squat',
        description: null,
        category: 'Strength',
        equipmentRequired: 'Machine',
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
        updatedAt: null,
      },
      planItem: {
        id: 'plan-item-1',
        workoutPlanId: 'plan-1',
        exerciseId: prescribedExerciseId,
        sequence: 1,
        targetSet: 3,
        targetRep: 5,
        targetWeight: 100,
        dayOfWeek: DayOfWeek.MON,
        notes: null,
        exercise: {
          id: prescribedExerciseId,
          name: 'Back Squat',
          description: null,
          category: 'Strength',
          equipmentRequired: 'Barbell',
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
          updatedAt: null,
        },
      },
    });

    const result = await service.createExerciseSetLog('session-1', memberUser, {
      exerciseId: substituteExerciseId,
      planItemId: 'plan-item-1',
      setNumber: 1,
      actualRep: 8,
      actualWeight: 90,
      rpe: 7,
    } as CreateExerciseSetLogDto);

    expect(prisma.exercise.findUnique).toHaveBeenCalledWith({
      where: { id: substituteExerciseId },
    });
    expect(prisma.exerciseSetLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workoutSessionId: 'session-1',
          exerciseId: substituteExerciseId,
          planItemId: 'plan-item-1',
          setNumber: 1,
          actualRep: 8,
          actualWeight: 90,
          rpe: 7,
        }),
      }),
    );
    expect(result.planItemId).toBe('plan-item-1');
    expect(result.prescribedExercise?.id).toBe(prescribedExerciseId);
    expect(result.isSubstitution).toBe(true);
    expect(result.exerciseId).toBe(substituteExerciseId);
  });
});
