import { Test, TestingModule } from '@nestjs/testing';
import { MembershipRecalculationService } from './membership.cron-job.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MembershipLevel } from '@prisma/client';

describe('MembershipRecalculationService', () => {
  let service: MembershipRecalculationService;
  let prisma: jest.Mocked<any>;

  beforeEach(async () => {
    prisma = {
      membership: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      userMembership: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      payment: {
        groupBy: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipRecalculationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MembershipRecalculationService>(
      MembershipRecalculationService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const basicTier = {
    id: 'tier-basic',
    name: 'Basic',
    description: null,
    minPrice: 0,
    level: 'BASIC' as MembershipLevel,
  };

  const premiumTier = {
    id: 'tier-premium',
    name: 'Premium',
    description: 'Full access',
    minPrice: 500000,
    level: 'PREMIUM' as MembershipLevel,
  };

  describe('source-aware protection', () => {
    it('should skip users with active paid memberships (paymentId not null)', async () => {
      prisma.membership.findMany.mockResolvedValue([premiumTier, basicTier]);

      // User has a paid active membership
      prisma.userMembership.findFirst.mockResolvedValueOnce({
        id: 'um-1',
        membershipName: 'Premium',
        paymentId: 'pay-123',
        status: 'normal',
        endDate: new Date('2027-01-01'),
      });

      const result = await service.recalculateUserMembership(
        'user-1',
        0, // $0 spend — cron would normally downgrade to BASIC
        [premiumTier, basicTier],
      );

      // Cron must NOT touch this user
      expect(result.action).toBe('skipped_paid');
      expect(prisma.userMembership.update).not.toHaveBeenCalled();
      expect(prisma.userMembership.create).not.toHaveBeenCalled();
    });

    it('should skip users with admin-granted memberships', async () => {
      prisma.userMembership.findFirst.mockResolvedValueOnce({
        id: 'um-2',
        membershipName: 'Premium',
        updatedByAdmin: true,
        paymentId: null,
        status: 'normal',
        endDate: new Date('2027-01-01'),
      });

      const result = await service.recalculateUserMembership(
        'user-2',
        0,
        [premiumTier, basicTier],
      );

      expect(result.action).toBe('skipped_paid');
    });

    it('should process users with only auto-assigned memberships', async () => {
      // No paid/admin membership
      prisma.userMembership.findFirst
        .mockResolvedValueOnce(null) // source-aware check
        .mockResolvedValueOnce(null); // same-tier check

      prisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          userMembership: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
            create: jest.fn(),
          },
        };
        return cb(tx);
      });

      const result = await service.recalculateUserMembership(
        'user-3',
        0,
        [premiumTier, basicTier],
      );

      expect(result.action).toBe('created');
    });
  });

  describe('transaction safety', () => {
    it('should use $transaction for expire + create path', async () => {
      // No paid membership
      prisma.userMembership.findFirst
        .mockResolvedValueOnce(null) // source-aware: no paid
        .mockResolvedValueOnce(null); // same-tier: no existing

      prisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          userMembership: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'um-old',
              membershipName: 'Basic',
            }),
            update: jest.fn(),
            create: jest.fn(),
          },
        };
        return cb(tx);
      });

      await service.recalculateUserMembership(
        'user-4',
        600000,
        [premiumTier, basicTier],
      );

      // Must have used $transaction
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('getUsersWithPurchaseAmounts (groupBy)', () => {
    it('should use groupBy instead of N+1 queries', async () => {
      prisma.membership.findMany.mockResolvedValue([basicTier]);

      prisma.payment.groupBy.mockResolvedValue([
        { userId: 'user-1', _sum: { amount: 100000 } },
        { userId: 'user-2', _sum: { amount: 600000 } },
      ]);

      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1' },
        { id: 'user-2' },
        { id: 'user-3' }, // user with no payments
      ]);

      // Source-aware and same-tier checks all return null
      prisma.userMembership.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          userMembership: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
            create: jest.fn(),
          },
        };
        return cb(tx);
      });

      const result = await service.recalculateAllUserMemberships();

      // Should use groupBy (1 query), not per-user payments (N queries)
      expect(prisma.payment.groupBy).toHaveBeenCalledWith({
        by: ['userId'],
        where: { targetType: 'MEMBERSHIP', status: 'SUCCESS' },
        _sum: { amount: true },
      });

      expect(result.totalUsersProcessed).toBe(3);
    });
  });

  describe('tier determination', () => {
    it('should return unchanged when no tiers exist', async () => {
      const result = await service.recalculateUserMembership('user-1', 0, []);
      expect(result.action).toBe('unchanged');
    });

    it('should not touch active same-tier membership', async () => {
      // No paid membership
      prisma.userMembership.findFirst
        .mockResolvedValueOnce(null) // source-aware
        .mockResolvedValueOnce({
          // same-tier active
          id: 'um-1',
          endDate: new Date('2027-01-01'),
          status: 'normal',
        });

      const result = await service.recalculateUserMembership(
        'user-1',
        0,
        [premiumTier, basicTier],
      );

      expect(result.action).toBe('unchanged');
    });
  });
});
