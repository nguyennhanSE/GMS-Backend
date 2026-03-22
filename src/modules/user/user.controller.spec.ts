import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { RolesService } from '../roles/roles.service';
import { ResponseModel } from '../../libs/models/response/response.model';
import { UserEntity } from './entities/user.entity';

describe('UserController', () => {
  let controller: UserController;
  let userService: jest.Mocked<UserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            updateAvatar: jest.fn(),
          },
        },
        {
          provide: RolesService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    userService = module.get(UserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('wraps the updated user when avatar upload succeeds', async () => {
    const updatedUser: UserEntity = {
      id: 'user-1',
      firstName: 'Test',
      lastName: 'User',
      email: 'user@test.local',
      avatarUrl:
        'https://res.cloudinary.com/demo/image/upload/v1/users/user-1/avatar/avatar-1.jpg',
      roles: [],
      memberships: [],
    };
    const file = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    userService.updateAvatar.mockResolvedValue(updatedUser);

    const result = await controller.updateAvatar('user-1', file);

    expect(userService.updateAvatar.mock.calls[0]).toEqual(['user-1', file]);
    expect(result).toBeInstanceOf(ResponseModel);
    expect(result.data.avatarUrl).toBe(updatedUser.avatarUrl);
  });
});
