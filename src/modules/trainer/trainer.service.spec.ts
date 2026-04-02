import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TrainerClientLinkStatus } from '@prisma/client';
import { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { CreateTrainerClientLinkDto, EndTrainerClientLinkDto } from './dto/trainer-client-link.dto';
import { TrainerService } from './trainer.service';
import { AppCacheService } from '../../libs/cache/cache.service';

describe('TrainerService', () => {
  let service: TrainerService;
  let trainerRepository: {
    getTrainerByUserId: jest.Mock;
    getMemberByUserId: jest.Mock;
    findActiveTrainerClientLink: jest.Mock;
    findTrainerClientLinkById: jest.Mock;
    createTrainerClientLink: jest.Mock;
    endTrainerClientLink: jest.Mock;
    listActiveTrainerClientLinks: jest.Mock;
    setAvailabilities: jest.Mock;
    getAvailabilities: jest.Mock;
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

  const memberUser = {
    id: 'member-1',
    firstName: 'Test',
    lastName: 'Member',
    email: 'member@test.local',
    password: 'hashed-password',
    phone: null,
    gender: null,
    dob: null,
    address: null,
    status: 'active',
    avatarUrl: null,
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    roles: [],
    memberships: [],
  };

  const activeLink = {
    id: 'link-1',
    trainerId: trainerUser.sub,
    memberId: memberUser.id,
    status: TrainerClientLinkStatus.ACTIVE,
    linkedAt: new Date('2026-03-24T00:00:00.000Z'),
    endedAt: null,
    endReason: null,
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    trainer: {
      id: trainerUser.sub,
      firstName: 'Coach',
      lastName: 'Trainer',
      email: trainerUser.email,
    },
    member: {
      id: memberUser.id,
      firstName: memberUser.firstName,
      lastName: memberUser.lastName,
      email: memberUser.email,
    },
  };

  const endedLink = {
    ...activeLink,
    status: TrainerClientLinkStatus.ENDED,
    endedAt: new Date('2026-03-25T00:00:00.000Z'),
    endReason: 'Client moved to another coach',
  };

  beforeEach(() => {
    trainerRepository = {
      getTrainerByUserId: jest.fn(),
      getMemberByUserId: jest.fn(),
      findActiveTrainerClientLink: jest.fn(),
      findTrainerClientLinkById: jest.fn(),
      createTrainerClientLink: jest.fn(),
      endTrainerClientLink: jest.fn(),
      listActiveTrainerClientLinks: jest.fn(),
      setAvailabilities: jest.fn(),
      getAvailabilities: jest.fn(),
    };

    appCacheService = {
      remember: jest.fn(
        async (_key: string, loader: () => Promise<unknown>) => loader(),
      ),
      invalidateTags: jest.fn().mockResolvedValue(undefined),
    };

    service = new TrainerService(
      trainerRepository as never,
      appCacheService as unknown as AppCacheService,
    );
  });

  it('creates an active trainer-client link after validating trainer and member', async () => {
    const dto: CreateTrainerClientLinkDto = {
      memberId: memberUser.id,
    };

    trainerRepository.getTrainerByUserId.mockResolvedValue({
      id: trainerUser.sub,
    });
    trainerRepository.getMemberByUserId.mockResolvedValue(memberUser);
    trainerRepository.findActiveTrainerClientLink.mockResolvedValue(null);
    trainerRepository.createTrainerClientLink.mockResolvedValue(activeLink);

    const result = await service.createTrainerClientLink(trainerUser.sub, dto);

    expect(trainerRepository.getTrainerByUserId).toHaveBeenCalledWith(
      trainerUser.sub,
    );
    expect(trainerRepository.getMemberByUserId).toHaveBeenCalledWith(
      memberUser.id,
    );
    expect(trainerRepository.findActiveTrainerClientLink).toHaveBeenCalledWith(
      trainerUser.sub,
      memberUser.id,
    );
    expect(trainerRepository.createTrainerClientLink).toHaveBeenCalledWith(
      trainerUser.sub,
      memberUser.id,
    );
    expect(result.id).toBe(activeLink.id);
    expect(result.status).toBe(TrainerClientLinkStatus.ACTIVE);
  });

  it('rejects duplicate active trainer-client links', async () => {
    trainerRepository.getTrainerByUserId.mockResolvedValue({
      id: trainerUser.sub,
    });
    trainerRepository.getMemberByUserId.mockResolvedValue(memberUser);
    trainerRepository.findActiveTrainerClientLink.mockResolvedValue(activeLink);

    await expect(
      service.createTrainerClientLink(trainerUser.sub, {
        memberId: memberUser.id,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ends an active trainer-client link and stores the reason', async () => {
    const dto: EndTrainerClientLinkDto = {
      endReason: 'Client moved to another coach',
    };

    trainerRepository.getTrainerByUserId.mockResolvedValue({
      id: trainerUser.sub,
    });
    trainerRepository.findTrainerClientLinkById.mockResolvedValue(activeLink);
    trainerRepository.endTrainerClientLink.mockResolvedValue(endedLink);

    const result = await service.endTrainerClientLink(
      trainerUser.sub,
      activeLink.id,
      dto,
    );

    expect(trainerRepository.endTrainerClientLink).toHaveBeenCalledWith(
      activeLink.id,
      dto.endReason,
    );
    expect(result.status).toBe(TrainerClientLinkStatus.ENDED);
    expect(result.endReason).toBe(dto.endReason);
  });

  it('lists only active linked members for the current trainer', async () => {
    trainerRepository.getTrainerByUserId.mockResolvedValue({
      id: trainerUser.sub,
    });
    trainerRepository.listActiveTrainerClientLinks.mockResolvedValue([activeLink]);

    const result = await service.listTrainerClientLinks(trainerUser);

    expect(trainerRepository.listActiveTrainerClientLinks).toHaveBeenCalledWith(
      trainerUser.sub,
    );
    expect(result).toHaveLength(1);
    expect(result[0].member.id).toBe(memberUser.id);
  });

  it('exposes the active trainer-client link lookup for future diet logic', async () => {
    trainerRepository.findActiveTrainerClientLink.mockResolvedValue(activeLink);

    const result = await service.findActiveTrainerClientLink(
      trainerUser.sub,
      memberUser.id,
    );

    expect(trainerRepository.findActiveTrainerClientLink).toHaveBeenCalledWith(
      trainerUser.sub,
      memberUser.id,
    );
    expect(result?.id).toBe(activeLink.id);
  });

  it('loads trainer availability through the shared cache service', async () => {
    const availability = [
      {
        id: 'slot-1',
        trainerId: trainerUser.sub,
        dayOfWeek: 1,
        startTime: new Date('2026-03-24T09:00:00.000Z'),
        endTime: new Date('2026-03-24T10:00:00.000Z'),
        isAvailable: true,
      },
    ];

    trainerRepository.getTrainerByUserId.mockResolvedValue({ id: trainerUser.sub });
    trainerRepository.getAvailabilities.mockResolvedValue(availability);
    appCacheService.remember.mockImplementation(
      async (_key: string, loader: () => Promise<unknown>) => loader(),
    );

    const result = await service.getAvailabilities(trainerUser.sub);

    expect(appCacheService.remember).toHaveBeenCalled();
    expect(result).toEqual(availability);
  });

  it('loads trainer detail through the shared cache service', async () => {
    const trainer = {
      id: trainerUser.sub,
      email: trainerUser.email,
    };

    trainerRepository.getTrainerByUserId.mockResolvedValue(trainer);
    appCacheService.remember.mockImplementation(
      async (_key: string, loader: () => Promise<unknown>) => loader(),
    );

    const result = await service.findOne(trainerUser.sub);

    expect(appCacheService.remember).toHaveBeenCalledWith(
      'gms:trainer:detail:trainer-1',
      expect.any(Function),
      expect.objectContaining({
        ttlSeconds: 300,
        tags: ['trainer:detail', 'trainer:id:trainer-1'],
      }),
    );
    expect(result).toEqual(trainer);
  });

  it('invalidates trainer availability tags when availabilities are replaced', async () => {
    const slots = [
      {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        isAvailable: true,
      },
    ];
    const updatedAvailability = [
      {
        id: 'slot-1',
        trainerId: trainerUser.sub,
        dayOfWeek: 1,
        startTime: new Date('2026-03-24T09:00:00.000Z'),
        endTime: new Date('2026-03-24T10:00:00.000Z'),
        isAvailable: true,
      },
    ];

    trainerRepository.getTrainerByUserId.mockResolvedValue({ id: trainerUser.sub });
    trainerRepository.setAvailabilities.mockResolvedValue(updatedAvailability);

    const result = await service.setAvailabilities(trainerUser.sub, slots as never);

    expect(trainerRepository.setAvailabilities).toHaveBeenCalledWith(
      trainerUser.sub,
      slots,
    );
    expect(appCacheService.invalidateTags).toHaveBeenCalledWith([
      'trainer:id:trainer-1',
      'trainer:availability:trainer-1',
    ]);
    expect(result).toEqual(updatedAvailability);
  });

  it('rejects ending a trainer-client link that does not belong to the trainer', async () => {
    trainerRepository.getTrainerByUserId.mockResolvedValue({
      id: trainerUser.sub,
    });
    trainerRepository.findTrainerClientLinkById.mockResolvedValue({
      ...activeLink,
      trainerId: 'trainer-2',
    });

    await expect(
      service.endTrainerClientLink(trainerUser.sub, activeLink.id, {
        endReason: 'Wrong trainer',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects ending a link that is already historical', async () => {
    trainerRepository.getTrainerByUserId.mockResolvedValue({
      id: trainerUser.sub,
    });
    trainerRepository.findTrainerClientLinkById.mockResolvedValue(endedLink);

    await expect(
      service.endTrainerClientLink(trainerUser.sub, activeLink.id, {
        endReason: 'Already ended',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
