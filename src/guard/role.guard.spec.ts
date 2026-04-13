import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppLogger } from 'src/libs/logger';
import { RolesGuard } from './role.guard';

describe('RolesGuard', () => {
  const createDeps = () => {
    const reflector = {
      getAllAndOverride: jest.fn(),
    };
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    return {
      reflector,
      logger,
      guard: new RolesGuard(
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

  it('allows routes that do not require roles', () => {
    const { guard, reflector } = createDeps();
    const context = createExecutionContext();

    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects requests without an authenticated user', () => {
    const { guard, reflector } = createDeps();
    const context = createExecutionContext({});

    reflector.getAllAndOverride.mockReturnValue(['admin']);

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('User not authenticated'),
    );
  });

  it('rejects users who do not have any required role', () => {
    const { guard, reflector } = createDeps();
    const context = createExecutionContext({
      user: {
        sub: 'user-1',
        roles: ['member'],
      },
    });

    reflector.getAllAndOverride.mockReturnValue(['admin']);

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Insufficient permissions'),
    );
  });

  it('allows users who have a required role', () => {
    const { guard, reflector } = createDeps();
    const context = createExecutionContext({
      user: {
        sub: 'user-1',
        roles: ['member', 'admin'],
      },
    });

    reflector.getAllAndOverride.mockReturnValue(['admin']);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('returns a generic forbidden error when role evaluation crashes', () => {
    const { guard, reflector } = createDeps();
    const context = createExecutionContext({
      user: {
        sub: 'user-1',
        roles: {
          includes: () => {
            throw new Error('roles unavailable');
          },
        },
      },
    });

    reflector.getAllAndOverride.mockReturnValue(['admin']);

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Unable to verify user permissions'),
    );
  });
});
