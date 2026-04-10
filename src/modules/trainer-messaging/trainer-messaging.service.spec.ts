import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { TrainerBookingService } from '../trainer-booking/trainer-booking.service';
import { ERoleName } from '../roles/enums/role.enum';
import { TrainerMessagingRepository } from './repositories/trainer-messaging.repository';
import { TrainerMessagingService } from './trainer-messaging.service';

describe('TrainerMessagingService', () => {
  let service: TrainerMessagingService;
  let repository: jest.Mocked<TrainerMessagingRepository>;
  let trainerBookingService: jest.Mocked<TrainerBookingService>;

  const memberUser: RequestUser = {
    sub: 'member-1',
    email: 'member@test.local',
    tokenType: 'Bearer',
    roles: [ERoleName.MEMBER],
  };

  const trainerUser: RequestUser = {
    sub: 'trainer-1',
    email: 'trainer@test.local',
    tokenType: 'Bearer',
    roles: [ERoleName.TRAINER],
  };

  const baseConversation = {
    id: 'conversation-1',
    memberId: 'member-1',
    trainerId: 'trainer-1',
    lastMessageAt: new Date('2030-01-01T10:00:00.000Z'),
    lastMessagePreview: 'Hello trainer',
    memberLastReadAt: new Date('2030-01-01T09:00:00.000Z'),
    trainerLastReadAt: null,
    createdAt: new Date('2030-01-01T09:00:00.000Z'),
    updatedAt: new Date('2030-01-01T10:00:00.000Z'),
    member: {
      id: 'member-1',
      firstName: 'Member',
      lastName: 'One',
      avatarUrl: null,
    },
    trainer: {
      id: 'trainer-1',
      firstName: 'Trainer',
      lastName: 'One',
      avatarUrl: 'https://example.com/trainer.png',
    },
  };

  beforeEach(async () => {
    repository = {
      listConversationsForUser: jest.fn(),
      findConversationById: jest.fn(),
      createOrGetConversation: jest.fn(),
      listMessages: jest.fn(),
      appendMessage: jest.fn(),
      markConversationRead: jest.fn(),
      countUnreadMessages: jest.fn(),
    } as unknown as jest.Mocked<TrainerMessagingRepository>;

    trainerBookingService = {
      isMessagingEligible: jest.fn(),
      listMessagingEligibleTrainers: jest.fn(),
      listMessagingEligibleMembers: jest.fn(),
    } as unknown as jest.Mocked<TrainerBookingService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerMessagingService,
        { provide: TrainerMessagingRepository, useValue: repository },
        { provide: TrainerBookingService, useValue: trainerBookingService },
      ],
    }).compile();

    service = module.get(TrainerMessagingService);
  });

  it('lists booking-eligible contacts and attaches an existing conversation id', async () => {
    trainerBookingService.listMessagingEligibleTrainers.mockResolvedValue([
      {
        id: 'trainer-1',
        firstName: 'Trainer',
        lastName: 'One',
        avatarUrl: 'https://example.com/trainer.png',
      },
    ]);
    repository.listConversationsForUser.mockResolvedValue([baseConversation]);

    const result = await service.listContacts(memberUser);

    expect(result).toEqual([
      {
        id: 'trainer-1',
        firstName: 'Trainer',
        lastName: 'One',
        avatarUrl: 'https://example.com/trainer.png',
        conversationId: 'conversation-1',
      },
    ]);
  });

  it('hides stored conversations when booking eligibility is gone', async () => {
    repository.listConversationsForUser.mockResolvedValue([baseConversation]);
    trainerBookingService.listMessagingEligibleTrainers.mockResolvedValue([]);

    await expect(service.listConversations(memberUser)).resolves.toEqual([]);
  });

  it('rejects creating a conversation for an ineligible pair', async () => {
    trainerBookingService.isMessagingEligible.mockResolvedValue(false);

    await expect(
      service.createOrGetConversation(memberUser, 'trainer-9'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects reading a conversation for a non-participant', async () => {
    repository.findConversationById.mockResolvedValue(baseConversation);

    await expect(
      service.getMessages(
        {
          ...memberUser,
          sub: 'member-2',
          email: 'other@test.local',
        },
        baseConversation.id,
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('trims, stores, and returns the sent message page', async () => {
    repository.findConversationById.mockResolvedValue(baseConversation);
    trainerBookingService.isMessagingEligible.mockResolvedValue(true);
    repository.appendMessage.mockResolvedValue({
      id: 'message-1',
      conversationId: baseConversation.id,
      senderUserId: memberUser.sub,
      content: 'Hello trainer',
      createdAt: new Date('2030-01-01T10:05:00.000Z'),
    });
    repository.listMessages.mockResolvedValue([
      {
        id: 'message-1',
        conversationId: baseConversation.id,
        senderUserId: memberUser.sub,
        content: 'Hello trainer',
        createdAt: new Date('2030-01-01T10:05:00.000Z'),
      },
    ]);
    repository.countUnreadMessages.mockResolvedValue(0);

    const result = await service.sendMessage(
      memberUser,
      baseConversation.id,
      '  Hello trainer  ',
    );

    expect(repository.appendMessage.mock.calls).toEqual([
      [
        {
          conversationId: baseConversation.id,
          senderUserId: memberUser.sub,
          content: 'Hello trainer',
          preview: 'Hello trainer',
          actor: 'member',
        },
      ],
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      content: 'Hello trainer',
      isOwn: true,
    });
  });

  it('rejects blank messages after trimming', async () => {
    repository.findConversationById.mockResolvedValue(baseConversation);
    trainerBookingService.isMessagingEligible.mockResolvedValue(true);

    await expect(
      service.sendMessage(memberUser, baseConversation.id, '   '),
    ).rejects.toThrow(BadRequestException);
  });

  it('marks a trainer conversation as read with the correct actor role', async () => {
    repository.findConversationById.mockResolvedValue(baseConversation);
    trainerBookingService.isMessagingEligible.mockResolvedValue(true);

    const result = await service.markConversationRead(
      trainerUser,
      baseConversation.id,
    );

    expect(repository.markConversationRead.mock.calls).toHaveLength(1);
    expect(repository.markConversationRead.mock.calls[0]?.[0]).toBe(
      baseConversation.id,
    );
    expect(repository.markConversationRead.mock.calls[0]?.[1]).toBe('trainer');
    expect(repository.markConversationRead.mock.calls[0]?.[2]).toBeInstanceOf(
      Date,
    );
    expect(result.conversationId).toBe(baseConversation.id);
  });
});
