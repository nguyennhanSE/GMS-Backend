import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { AppCacheService } from '../../libs/cache/cache.service';

describe('MembershipsService', () => {
  let service: MembershipsService;
  let prisma: jest.Mocked<any>;
  let paymentService: jest.Mocked<any>;
  let appCacheService: {
    remember: jest.Mock;
    invalidateTags: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      membership: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      userMembership: {
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    paymentService = {
      createCheckout: jest.fn(),
    };

    appCacheService = {
      remember: jest.fn((_key, loader) => loader()),
      invalidateTags: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentService, useValue: paymentService },
        { provide: AppCacheService, useValue: appCacheService },
      ],
    }).compile();

    service = module.get<MembershipsService>(MembershipsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('CRUD', () => {
    const mockTier = {
      id: 'tier-1',
      name: 'Premium',
      description: 'Full access',
      minPrice: 500000,
      purchasePrice: 480000,
      level: 'PREMIUM',
      createdAt: new Date(),
      updatedAt: null,
    };

    it('create should create a membership tier', async () => {
      prisma.membership.create.mockResolvedValue(mockTier);

      const result = await service.create({
        name: 'Premium',
        description: 'Full access',
        minPrice: 500000,
        purchasePrice: 480000,
        level: 'PREMIUM' as any,
      });

      expect(result).toEqual(mockTier);
      expect(prisma.membership.create).toHaveBeenCalled();
      expect(appCacheService.invalidateTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'membership:list',
          'membership:detail',
          'membership:id:tier-1',
        ]),
      );
    });

    it('findAll should return all tiers sorted by minPrice', async () => {
      prisma.membership.findMany.mockResolvedValue([mockTier]);

      const result = await service.findAll();

      expect(result).toEqual([mockTier]);
      expect(prisma.membership.findMany).toHaveBeenCalledWith({
        orderBy: { minPrice: 'asc' },
      });
      expect(appCacheService.remember).toHaveBeenCalledWith(
        'gms:membership:list',
        expect.any(Function),
        expect.objectContaining({
          ttlSeconds: 900,
          tags: ['membership:list'],
        }),
      );
    });

    it('findOne should return a tier by id', async () => {
      prisma.membership.findUnique.mockResolvedValue(mockTier);

      const result = await service.findOne('tier-1');

      expect(result).toEqual(mockTier);
      expect(appCacheService.remember).toHaveBeenCalledWith(
        'gms:membership:detail:tier-1',
        expect.any(Function),
        expect.objectContaining({
          ttlSeconds: 900,
          tags: ['membership:detail', 'membership:id:tier-1'],
        }),
      );
    });

    it('findOne should throw NotFoundException if not found', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('remove should prevent deletion with active user memberships', async () => {
      prisma.membership.findUnique.mockResolvedValue(mockTier);
      prisma.userMembership.count.mockResolvedValue(3);

      await expect(service.remove('tier-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('remove should delete tier if no active memberships', async () => {
      prisma.membership.findUnique.mockResolvedValue(mockTier);
      prisma.userMembership.count.mockResolvedValue(0);
      prisma.membership.delete.mockResolvedValue(mockTier);

      const result = await service.remove('tier-1');

      expect(result.message).toContain('tier-1');
      expect(prisma.membership.delete).toHaveBeenCalledWith({
        where: { id: 'tier-1' },
      });
      expect(appCacheService.invalidateTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          'membership:list',
          'membership:detail',
          'membership:id:tier-1',
        ]),
      );
    });
  });

  describe('initiateCheckout', () => {
    it('should use purchasePrice (not minPrice) for checkout amount', async () => {
      const tier = {
        id: 'tier-1',
        name: 'Premium',
        purchasePrice: 480000,
        minPrice: 500000,
      };
      prisma.membership.findUnique.mockResolvedValue(tier);
      paymentService.createCheckout.mockResolvedValue({
        checkoutUrl: 'https://stripe.com/checkout/123',
      });

      const result = await service.initiateCheckout('tier-1', 'user-1');

      expect(paymentService.createCheckout).toHaveBeenCalledWith('user-1', {
        targetType: 'MEMBERSHIP',
        targetId: 'tier-1',
        amount: 480000,
        currency: 'VND',
      });
      expect(result.checkoutUrl).toBe('https://stripe.com/checkout/123');
    });

    it('should throw if purchasePrice is 0', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'tier-1',
        purchasePrice: 0,
      });

      await expect(
        service.initiateCheckout('tier-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('activateByPayment', () => {
    const mockMembership = {
      id: 'tier-1',
      name: 'Premium',
      description: 'Full access',
      level: 'PREMIUM',
    };

    it('should time-stack when same-tier active exists', async () => {
      prisma.membership.findUnique.mockResolvedValue(mockMembership);

      const existingEndDate = new Date('2026-06-01');
      const expectedEnd = new Date('2027-06-01');

      // $transaction executes the callback with a tx client
      const tx = {
          userMembership: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce({
                id: 'um-1',
                endDate: existingEndDate,
                status: 'normal',
              })
              .mockResolvedValueOnce(null),
            update: jest.fn().mockResolvedValue({
              id: 'um-1',
              endDate: expectedEnd,
            }),
            create: jest.fn(),
          },
        };
      prisma.$transaction.mockImplementation(
        (cb: (client: typeof tx) => unknown) => cb(tx),
      );

      const result = await service.activateByPayment(
        'pay-1',
        'user-1',
        'tier-1',
      );

      expect(result.endDate).toEqual(expectedEnd);
    });

    it('should soft-expire different-tier and create new', async () => {
      prisma.membership.findUnique.mockResolvedValue(mockMembership);

      const tx = {
          userMembership: {
            findFirst: jest
              .fn()
              // Same tier check → null (no same-tier active)
              .mockResolvedValueOnce(null)
              // Other tier check → found BASIC
              .mockResolvedValueOnce({
                id: 'um-old',
                membershipName: 'Basic',
                status: 'normal',
              }),
            update: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockResolvedValue({
              id: 'um-new',
              membershipName: 'Premium',
            }),
          },
        };
      prisma.$transaction.mockImplementation(
        (cb: (client: typeof tx) => unknown) => cb(tx),
      );

      const result = await service.activateByPayment(
        'pay-1',
        'user-1',
        'tier-1',
      );

      expect(result.membershipName).toBe('Premium');
    });
  });

  describe('deactivateByPayment', () => {
    it('should expire membership linked to payment', async () => {
      prisma.userMembership.findFirst.mockResolvedValue({
        id: 'um-1',
        membershipName: 'Premium',
        status: 'normal',
        paymentId: 'pay-1',
      });
      prisma.userMembership.update.mockResolvedValue({});

      await service.deactivateByPayment('pay-1');

      expect(prisma.userMembership.update).toHaveBeenCalledWith({
        where: { id: 'um-1' },
        data: {
          status: 'expired',
          endDate: expect.any(Date),
        },
      });
    });

    it('should skip if already expired', async () => {
      prisma.userMembership.findFirst.mockResolvedValue({
        id: 'um-1',
        status: 'expired',
      });

      await service.deactivateByPayment('pay-1');

      expect(prisma.userMembership.update).not.toHaveBeenCalled();
    });

    it('should skip if no membership linked to payment', async () => {
      prisma.userMembership.findFirst.mockResolvedValue(null);

      await service.deactivateByPayment('pay-1');

      expect(prisma.userMembership.update).not.toHaveBeenCalled();
    });
  });
});
