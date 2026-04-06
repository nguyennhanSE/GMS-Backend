import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType } from '@prisma/client';
import { NotificationEmailListener } from './notification-email.listener';
import { UserEmailService } from './email.service';
import type { NotificationEventPayload } from '../../common/events/notification.events';

describe('NotificationEmailListener', () => {
  let listener: NotificationEmailListener;
  let emailService: jest.Mocked<any>;

  const payload: NotificationEventPayload = {
    userId: 'user-1',
    userEmail: 'member@test.local',
    userName: 'Test Member',
    type: NotificationType.PAYMENT,
    title: 'Payment failed',
    message: 'Please update your card.',
    referenceId: 'payment-1',
    metadata: { eventKey: 'notification.payment.failed' },
  };

  beforeEach(async () => {
    emailService = {
      sendNotificationEmail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationEmailListener,
        { provide: UserEmailService, useValue: emailService },
      ],
    }).compile();

    listener = module.get(NotificationEmailListener);
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  it('sends the mapped notification email payload', async () => {
    await listener.handlePaymentFailed(payload);

    expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
      {
        id: 'user-1',
        name: 'Test Member',
        email: 'member@test.local',
      },
      'Payment failed',
      'Please update your card.',
    );
  });

  it('swallows email errors so the event chain does not fail', async () => {
    emailService.sendNotificationEmail.mockRejectedValue(
      new Error('SMTP timeout'),
    );

    await expect(listener.handleClassCancelled(payload)).resolves.toBeUndefined();
  });

  it('routes trainer-booking notification events through the same email sender', async () => {
    await listener.handleTrainerBookingNotification({
      ...payload,
      type: NotificationType.BOOKING,
      title: 'Trainer booking reminder',
      metadata: { eventKey: 'notification.trainer-booking.reminder' },
    });

    expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
      {
        id: 'user-1',
        name: 'Test Member',
        email: 'member@test.local',
      },
      'Trainer booking reminder',
      'Please update your card.',
    );
  });
});
