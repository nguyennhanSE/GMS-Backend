import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LogoutDto,
  RefreshTokenRequestDto,
  RegisterMemberDto,
} from './dto/auth.dto';

describe('AuthController', () => {
  const createController = () => {
    const authService = {
      login: jest.fn(),
      logout: jest.fn(),
      refreshToken: jest.fn(),
      registerMember: jest.fn(),
    };

    return {
      authService,
      controller: new AuthController(authService as unknown as AuthService),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('register wraps the created user response without exposing the password', async () => {
    const { controller, authService } = createController();
    const dto = {
      email: 'member@example.com',
      password: 'Password123',
      confirmPassword: 'Password123',
      firstName: 'Test',
      lastName: 'Member',
    } as RegisterMemberDto;

    authService.registerMember.mockResolvedValue({
      id: 'user-1',
      email: dto.email,
      firstName: 'Test',
      lastName: 'Member',
      password: 'hashed-password',
      roles: [],
      memberships: [],
    });

    const response = await controller.register(dto);

    expect(authService.registerMember).toHaveBeenCalledWith(dto);
    expect(response.data).toMatchObject({
      id: 'user-1',
      email: dto.email,
      firstName: 'Test',
      lastName: 'Member',
    });
    expect(response.data.password).toBeUndefined();
  });

  it('login wraps the auth service response', async () => {
    const { controller, authService } = createController();
    const dto = {
      username: 'member@example.com',
      password: 'Password123',
    } as LoginDto;
    const result = {
      user: { id: 'user-1', email: 'member@example.com' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    };

    authService.login.mockResolvedValue(result);

    const response = await controller.login(dto);

    expect(authService.login).toHaveBeenCalledWith(dto);
    expect(response.data).toEqual(result);
  });

  it('logout wraps the auth service response', async () => {
    const { controller, authService } = createController();
    const dto = { refreshToken: 'refresh-token' } as LogoutDto;

    authService.logout.mockResolvedValue({ success: true });

    const response = await controller.logout(dto);

    expect(authService.logout).toHaveBeenCalledWith(dto);
    expect(response.data).toEqual({ success: true });
  });

  it('refreshToken wraps the auth service response', async () => {
    const { controller, authService } = createController();
    const dto = {
      refreshToken: 'refresh-token',
      ip: '127.0.0.1',
    } as RefreshTokenRequestDto;

    authService.refreshToken.mockResolvedValue({
      accessToken: 'new-access-token',
      newRefreshToken: 'new-refresh-token',
    });

    const response = await controller.refreshToken(dto);

    expect(authService.refreshToken).toHaveBeenCalledWith(dto);
    expect(response.data).toEqual({
      accessToken: 'new-access-token',
      newRefreshToken: 'new-refresh-token',
    });
  });
});
