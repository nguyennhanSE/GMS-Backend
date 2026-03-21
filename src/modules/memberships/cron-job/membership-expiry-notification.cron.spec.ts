import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MembershipExpiryNotificationCronService } from './membership-expiry-notification.cron';
import { NOTIFICATION_EVENTS } from '../../../common/events/notification.events';

describe('MembershipExpiryNotificationCronService', () => {
  let service: MembershipExpiryNotificationCronService;
  let prisma: jest.Mocked<any>;
  let eventEmitter: jest.Mocked<any>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-19T01:00:00Z'));

    prisma = {
      userMembership: {
        findMany: jest.fn(),
      },
      notification: {
        count: jest.fn(),
      },
    };

    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipExpiryNotificationCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(MembershipExpiryNotificationCronService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits one event for an expiring membership when no duplicate exists for the day', async () => {
    prisma.userMembership.findMany.mockResolvedValue([
      {
        id: 'um-1',
        userId: 'user-1',
        membershipId: 'membership-1',
        membershipName: 'Premium',
        endDate: new Date('2026-03-22T08:00:00Z'),
        user: {
          id: 'user-1',
          email: 'member@test.local',
          firstName: 'Test',
          lastName: 'Member',
        },
        membership: {
          id: 'membership-1',
        },
      },
    ]);
    prisma.notification.count.mockResolvedValue(0);

    await service.handleMembershipExpiryNotifications();

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: NotificationType.MEMBERSHIP,
        referenceId: 'um-1',
        createdAt: {
          gte: new Date(2026, 2, 19),
          lt: new Date(2026, 2, 20),
        },
      },
    });
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.MEMBERSHIP_EXPIRING,
      expect.objectContaining({
        userId: 'user-1',
        referenceId: 'um-1',
        title: 'Membership expiring soon',
      }),
    );
  });

  it('suppresses duplicate notifications when one already exists for the same day', async () => {
    prisma.userMembership.findMany.mockResolvedValue([
      {
        id: 'um-1',
        userId: 'user-1',
        membershipId: 'membership-1',
        membershipName: 'Premium',
        endDate: new Date('2026-03-22T08:00:00Z'),
        user: {
          id: 'user-1',
          email: 'member@test.local',
          firstName: 'Test',
          lastName: 'Member',
        },
        membership: {
          id: 'membership-1',
        },
      },
    ]);
    prisma.notification.count.mockResolvedValue(1);

    await service.handleMembershipExpiryNotifications();

    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});
