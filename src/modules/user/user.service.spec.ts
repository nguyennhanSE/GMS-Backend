import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { UserRepository } from './repositories/user.repository';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorageService } from '../storage/storage.service';
import { AppLogger } from '../../libs/logger';
import { UserEntity } from './entities/user.entity';

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
      avatarUrl: 'https://bucket.s3.region.amazonaws.com/users/user-1/avatar/file.jpg',
    };
    const file = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    userRepository.getUserByAccount.mockResolvedValue(existingUser);
    storageService.uploadUserAvatar.mockResolvedValue({
      url: updatedUser.avatarUrl,
      key: 'users/user-1/avatar/file.jpg',
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
      updatedUser.avatarUrl,
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
      url: 'https://bucket.s3.region.amazonaws.com/users/user-1/avatar/file.png',
      key: 'users/user-1/avatar/file.png',
      contentType: 'image/png',
    });
    userRepository.updateAvatarUrl.mockRejectedValue(new Error('db failed'));

    await expect(service.updateAvatar('user-1', file)).rejects.toThrow(
      'db failed',
    );

    expect(storageService.deleteObject.mock.calls[0]).toEqual([
      'users/user-1/avatar/file.png',
    ]);
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
      url: 'https://bucket.s3.region.amazonaws.com/users/user-1/avatar/file.webp',
      key: 'users/user-1/avatar/file.webp',
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
