import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { AppLogger } from '../../libs/logger';
import { StorageService } from '../storage/storage.service';
import { UserEmailService } from '../email/email.service';
import { UserEntity } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let userRepository: jest.Mocked<UserRepository>;
  let storageService: jest.Mocked<StorageService>;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: UserRepository,
          useValue: {
            getUserByAccount: jest.fn(),
            updateAvatarUrl: jest.fn(),
            deleteUser: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emitAsync: jest.fn() },
        },
        {
          provide: StorageService,
          useValue: {
            uploadUserAvatar: jest.fn(),
            deleteObject: jest.fn(),
          },
        },
        {
          provide: UserEmailService,
          useValue: {
            sendAccountVerificationEmail: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: AppLogger,
          useValue: {
            error: jest.fn(),
            warn: jest.fn(),
            log: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(UserRepository);
    storageService = module.get(StorageService);
    logger = module.get(AppLogger);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('uploads an avatar and persists the returned url', async () => {
    const avatarUrl =
      'https://res.cloudinary.com/demo-cloud/image/upload/v1234/users/user-1/avatar/1234-uuid.jpg';
    const existingUser: UserEntity = {
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 'user@test.local',
      roles: [],
      memberships: [],
    };
    const updatedUser: UserEntity = {
      ...existingUser,
      avatarUrl,
    };
    const file = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    userRepository.getUserByAccount.mockResolvedValue(existingUser);
    storageService.uploadUserAvatar.mockResolvedValue({
      url: avatarUrl,
      key: 'users/user-1/avatar/1234-uuid',
      contentType: 'image/jpeg',
    });
    userRepository.updateAvatarUrl.mockResolvedValue(updatedUser);

    const result = await service.updateAvatar('user-1', file);

    expect(storageService.uploadUserAvatar.mock.calls[0]).toEqual([
      {
        userId: 'user-1',
        file,
      },
    ]);
    expect(userRepository.updateAvatarUrl.mock.calls[0]).toEqual([
      'user-1',
      avatarUrl,
    ]);
    expect(storageService.deleteObject.mock.calls).toHaveLength(0);
    expect(result).toBe(updatedUser);
  });

  it('deletes the uploaded object if avatar persistence fails', async () => {
    const file = {
      mimetype: 'image/png',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    userRepository.getUserByAccount.mockResolvedValue({
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 'user@test.local',
      roles: [],
      memberships: [],
    });
    storageService.uploadUserAvatar.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1234/users/user-1/avatar/1234-uuid.png',
      key: 'users/user-1/avatar/1234-uuid',
      contentType: 'image/png',
    });
    userRepository.updateAvatarUrl.mockRejectedValue(new Error('db failed'));

    await expect(service.updateAvatar('user-1', file)).rejects.toThrow(
      'db failed',
    );

    expect(storageService.deleteObject.mock.calls[0]).toEqual([
      'users/user-1/avatar/1234-uuid',
    ]);
  });

  it('does not persist avatar data when upload fails', async () => {
    const file = {
      mimetype: 'image/png',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    userRepository.getUserByAccount.mockResolvedValue({
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 'user@test.local',
      roles: [],
      memberships: [],
    });
    storageService.uploadUserAvatar.mockRejectedValue(
      new Error('upload failed'),
    );

    await expect(service.updateAvatar('user-1', file)).rejects.toThrow(
      'upload failed',
    );

    expect(userRepository.updateAvatarUrl.mock.calls).toHaveLength(0);
    expect(storageService.deleteObject.mock.calls).toHaveLength(0);
  });

  it('logs the orphaned key when compensating cleanup fails', async () => {
    const file = {
      mimetype: 'image/webp',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    userRepository.getUserByAccount.mockResolvedValue({
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 'user@test.local',
      roles: [],
      memberships: [],
    });
    storageService.uploadUserAvatar.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1234/users/user-1/avatar/1234-uuid.webp',
      key: 'users/user-1/avatar/1234-uuid',
      contentType: 'image/webp',
    });
    userRepository.updateAvatarUrl.mockRejectedValue(new Error('db failed'));
    storageService.deleteObject.mockRejectedValue(new Error('cleanup failed'));

    await expect(service.updateAvatar('user-1', file)).rejects.toThrow(
      'db failed',
    );

    expect(logger.error.mock.calls.length).toBeGreaterThan(0);
  });
});
