import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { tokenType } from 'src/common/enums';
import { AppLogger } from 'src/libs/logger';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  const createDeps = () => {
    const reflector = {
      getAllAndOverride: jest.fn(),
    };
    const jwtService = {
      verifyAsync: jest.fn(),
    };
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    return {
      reflector,
      jwtService,
      logger,
      guard: new AuthGuard(
        jwtService as unknown as JwtService,
        reflector as unknown as Reflector,
        logger as unknown as AppLogger,
      ),
    };
  };

  const createExecutionContext = (request: Record<string, unknown> = {}) =>
    ({
      getClass: jest.fn(),
      getHandler: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows public routes without validating a token', async () => {
    const { guard, reflector, jwtService } = createDeps();
    const context = createExecutionContext();

    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects requests without a bearer token', async () => {
    const { guard, reflector } = createDeps();
    const context = createExecutionContext({ headers: {} });

    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Access token is required'),
    );
  });

  it('attaches the authenticated user to the request for valid access tokens', async () => {
    const { guard, reflector, jwtService } = createDeps();
    const request = {
      headers: {
        authorization: 'Bearer access-token',
      },
    } as Record<string, any>;
    const context = createExecutionContext(request);

    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'member@example.com',
      tokenType: tokenType.AccessToken,
      roles: ['member'],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      sub: 'user-1',
      email: 'member@example.com',
      tokenType: tokenType.AccessToken,
      roles: ['member'],
    });
  });

  it('rejects tokens with the wrong token type', async () => {
    const { guard, reflector, jwtService } = createDeps();
    const context = createExecutionContext({
      headers: {
        authorization: 'Bearer refresh-token',
      },
    });

    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'member@example.com',
      tokenType: tokenType.RefreshToken,
      roles: ['member'],
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired token'),
    );
  });

  it('rejects invalid or expired JWTs', async () => {
    const { guard, reflector, jwtService } = createDeps();
    const context = createExecutionContext({
      headers: {
        authorization: 'Bearer broken-token',
      },
    });

    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired token'),
    );
  });
});
