import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { tokenType } from 'src/common/enums';
import { config } from 'src/libs/config';
import { AppLogger } from 'src/libs/logger';
import { comparePassword } from 'src/utils/encrypt';
import { RolesService } from '../roles/roles.service';
import { UserService } from '../user/user.service';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LogoutDto,
  RefreshTokenRequestDto,
  RegisterMemberDto,
} from './dto/auth.dto';
import { AuthRepository } from './repositories/auth.repository';

jest.mock('src/utils/encrypt', () => ({
  comparePassword: jest.fn(),
}));

const mockedComparePassword = jest.mocked(comparePassword);

describe('AuthService', () => {
  type AuthUser = {
    id: string;
    email: string;
    password?: string;
    firstName: string;
    lastName: string;
    status: string;
  };

  const createDeps = () => {
    const authRepository = {
      decodeToken: jest.fn(),
      deleteToken: jest.fn(),
      findToken: jest.fn(),
      generateToken: jest.fn(),
      isRefreshTokenUsed: jest.fn(),
      markRefreshTokenUsed: jest.fn(),
      removeAllSessionOfUser: jest.fn(),
      storeToken: jest.fn(),
      updateToken: jest.fn(),
    };

    const userService = {
      getUserByAccount: jest.fn(),
      getUserByEmail: jest.fn(),
      registerMember: jest.fn(),
    };

    const roleService = {
      getUserRoles: jest.fn(),
    };

    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    return {
      authRepository,
      userService,
      roleService,
      logger,
      service: new AuthService(
        authRepository as unknown as AuthRepository,
        userService as unknown as UserService,
        roleService as unknown as RolesService,
        logger as unknown as AppLogger,
      ),
    };
  };

  const createUser = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'user-1',
      email: 'member@example.com',
      password: 'hashed-password',
      firstName: 'Test',
      lastName: 'Member',
      status: 'active',
      ...overrides,
    }) as AuthUser;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers a member through UserService', async () => {
    const { service, userService } = createDeps();
    const dto = {
      email: 'member@example.com',
      password: 'Password123',
      confirmPassword: 'Password123',
      firstName: 'Test',
      lastName: 'Member',
    } as RegisterMemberDto;
    const createdUser = createUser();

    userService.registerMember.mockResolvedValue(createdUser);

    await expect(service.registerMember(dto)).resolves.toBe(createdUser);

    expect(userService.registerMember).toHaveBeenCalledWith(dto);
  });

  it('login rejects requests without a username', async () => {
    const { service } = createDeps();

    await expect(
      service.login({ username: '', password: 'Password123' } as LoginDto),
    ).rejects.toThrow(new BadRequestException('Username is required'));
  });

  it('login rejects inactive users', async () => {
    const { service, userService } = createDeps();

    userService.getUserByEmail.mockResolvedValue(createUser({ status: 'banned' }));

    await expect(
      service.login({
        username: 'member@example.com',
        password: 'Password123',
      } as LoginDto),
    ).rejects.toThrow(
      new UnauthorizedException('Account is inactive or banned'),
    );
  });

  it('login rejects invalid passwords', async () => {
    const { service, userService } = createDeps();

    userService.getUserByEmail.mockResolvedValue(createUser());
    mockedComparePassword.mockResolvedValue(false);

    await expect(
      service.login({
        username: 'member@example.com',
        password: 'WrongPassword123',
      } as LoginDto),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('login issues tokens and stores the refresh token', async () => {
    const { service, authRepository, userService, roleService } = createDeps();
    const user = createUser();

    userService.getUserByEmail.mockResolvedValue(user);
    roleService.getUserRoles.mockResolvedValue(['member']);
    mockedComparePassword.mockResolvedValue(true);
    authRepository.generateToken
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');
    authRepository.storeToken.mockResolvedValue({ id: 'session-1' });

    const result = await service.login({
      username: user.email,
      password: 'Password123',
      rememberMe: true,
      ip: '127.0.0.1',
    } as LoginDto);

    expect(result).toEqual({
      user: {
        email: user.email,
        name: 'Test Member',
        id: user.id,
        account: user.email,
      },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(roleService.getUserRoles).toHaveBeenCalledWith(user.id);
    expect(authRepository.generateToken).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sub: user.id,
        tokenType: tokenType.AccessToken,
        email: user.email,
        roles: ['member'],
      }),
      expect.objectContaining({
        secret: config.JWT_SECRET_ACCESS_TOKEN,
        expiresIn: config.ACCESS_TOKEN_EXPIRES_IN,
      }),
    );
    expect(authRepository.generateToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sub: user.id,
        tokenType: tokenType.RefreshToken,
        email: user.email,
        roles: ['member'],
      }),
      expect.objectContaining({
        secret: config.JWT_SECRET_REFRESH_TOKEN,
        expiresIn: config.REFRESH_TOKEN_REMEMBER_EXPIRES_IN,
      }),
    );
    expect(authRepository.storeToken).toHaveBeenCalledWith(
      'refresh-token',
      { secret: config.JWT_SECRET_REFRESH_TOKEN },
      '127.0.0.1',
    );
  });

  it('login builds unique refresh token payloads for repeated logins', async () => {
    const { service, authRepository, userService, roleService } = createDeps();
    const user = createUser();

    userService.getUserByEmail.mockResolvedValue(user);
    roleService.getUserRoles.mockResolvedValue(['member']);
    mockedComparePassword.mockResolvedValue(true);
    authRepository.generateToken.mockImplementation(async payload =>
      JSON.stringify(payload),
    );
    authRepository.storeToken.mockResolvedValue({ id: 'session-1' });

    const first = await service.login({
      username: user.email,
      password: 'Password123',
    } as LoginDto);
    const second = await service.login({
      username: user.email,
      password: 'Password123',
    } as LoginDto);

    const firstRefreshPayload = JSON.parse(first.refreshToken) as {
      jti?: string;
      tokenType: string;
    };
    const secondRefreshPayload = JSON.parse(second.refreshToken) as {
      jti?: string;
      tokenType: string;
    };

    expect(firstRefreshPayload.tokenType).toBe(tokenType.RefreshToken);
    expect(secondRefreshPayload.tokenType).toBe(tokenType.RefreshToken);
    expect(firstRefreshPayload.jti).toEqual(expect.any(String));
    expect(secondRefreshPayload.jti).toEqual(expect.any(String));
    expect(firstRefreshPayload.jti).not.toBe(secondRefreshPayload.jti);
  });

  it('logout rejects requests without a refresh token', async () => {
    const { service } = createDeps();

    await expect(service.logout({} as LogoutDto)).rejects.toThrow(
      new BadRequestException('Missing refresh token'),
    );
  });

  it('logout removes an active session', async () => {
    const { service, authRepository } = createDeps();

    authRepository.findToken.mockResolvedValue({ id: 'session-1' });

    await expect(
      service.logout({ refreshToken: 'refresh-token' } as LogoutDto),
    ).resolves.toEqual({ success: true });

    expect(authRepository.deleteToken).toHaveBeenCalledWith('refresh-token');
  });

  it('refreshToken blocks reused refresh tokens and revokes all sessions', async () => {
    const { service, authRepository } = createDeps();

    authRepository.isRefreshTokenUsed.mockResolvedValue(true);
    authRepository.decodeToken.mockResolvedValue({
      sub: 'user-1',
      email: 'member@example.com',
      username: 'user-1',
      tokenType: tokenType.RefreshToken,
      roles: ['member'],
    });

    await expect(
      service.refreshToken({
        refreshToken: 'used-refresh-token',
        ip: '127.0.0.1',
      } as RefreshTokenRequestDto),
    ).rejects.toThrow(
      new UnauthorizedException(
        'Refresh token already used!! Please login again',
      ),
    );

    expect(authRepository.removeAllSessionOfUser).toHaveBeenCalledWith('user-1');
  });

  it('refreshToken rotates tokens for an active session', async () => {
    const { service, authRepository, userService, roleService } = createDeps();
    const user = createUser();

    authRepository.isRefreshTokenUsed.mockResolvedValue(false);
    authRepository.decodeToken.mockResolvedValue({
      sub: user.id,
      email: user.email,
      username: user.id,
      tokenType: tokenType.RefreshToken,
      roles: ['member'],
    });
    authRepository.findToken.mockResolvedValue({ id: 'session-1' });
    userService.getUserByAccount.mockResolvedValue(user);
    roleService.getUserRoles.mockResolvedValue(['member']);
    authRepository.generateToken
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');
    authRepository.updateToken.mockResolvedValue({ id: 'session-1' });

    await expect(
      service.refreshToken({
        refreshToken: 'refresh-token',
        ip: '10.0.0.2',
      } as RefreshTokenRequestDto),
    ).resolves.toEqual({
      accessToken: 'new-access-token',
      newRefreshToken: 'new-refresh-token',
    });

    expect(authRepository.updateToken).toHaveBeenCalledWith(
      'new-refresh-token',
      { secret: config.JWT_SECRET_REFRESH_TOKEN },
      'session-1',
      '10.0.0.2',
    );
    expect(authRepository.markRefreshTokenUsed).toHaveBeenCalledWith(
      'refresh-token',
      'session-1',
    );
  });

  it('refreshToken rejects inactive users and revokes their sessions', async () => {
    const { service, authRepository, userService } = createDeps();

    authRepository.isRefreshTokenUsed.mockResolvedValue(false);
    authRepository.decodeToken.mockResolvedValue({
      sub: 'user-1',
      email: 'member@example.com',
      username: 'user-1',
      tokenType: tokenType.RefreshToken,
      roles: ['member'],
    });
    authRepository.findToken.mockResolvedValue({ id: 'session-1' });
    userService.getUserByAccount.mockResolvedValue(
      createUser({ status: 'inactive' }),
    );

    await expect(
      service.refreshToken({
        refreshToken: 'refresh-token',
      } as RefreshTokenRequestDto),
    ).rejects.toThrow(
      new UnauthorizedException('Account is inactive or banned'),
    );

    expect(authRepository.removeAllSessionOfUser).toHaveBeenCalledWith('user-1');
  });

  it('refreshToken throws when the session cannot be found', async () => {
    const { service, authRepository } = createDeps();

    authRepository.isRefreshTokenUsed.mockResolvedValue(false);
    authRepository.decodeToken.mockResolvedValue({
      sub: 'user-1',
      email: 'member@example.com',
      username: 'user-1',
      tokenType: tokenType.RefreshToken,
      roles: ['member'],
    });
    authRepository.findToken.mockResolvedValue(null);

    await expect(
      service.refreshToken({
        refreshToken: 'refresh-token',
      } as RefreshTokenRequestDto),
    ).rejects.toThrow(new NotFoundException('Session not found'));
  });

  it('oauthLogin issues tokens for an existing user', async () => {
    const { service, authRepository, userService, roleService } = createDeps();
    const user = createUser();

    userService.getUserByAccount.mockResolvedValue(user);
    roleService.getUserRoles.mockResolvedValue(['member']);
    authRepository.generateToken
      .mockResolvedValueOnce('oauth-access-token')
      .mockResolvedValueOnce('oauth-refresh-token');

    await expect(
      service.oauthLogin(user.id, user.email, '192.168.1.2'),
    ).resolves.toEqual({
      user: {
        email: user.email,
        name: 'Test Member',
        id: user.id,
        account: user.id,
      },
      accessToken: 'oauth-access-token',
      refreshToken: 'oauth-refresh-token',
    });

    expect(authRepository.storeToken).toHaveBeenCalledWith(
      'oauth-refresh-token',
      { secret: config.JWT_SECRET_REFRESH_TOKEN },
      '192.168.1.2',
    );
  });
});
