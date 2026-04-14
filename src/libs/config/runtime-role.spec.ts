import {
  parseAppRuntimeRole,
  shouldRunBackgroundWorkers,
  shouldServeHttp,
} from './runtime-role';

describe('runtime role helpers', () => {
  it('defaults to all outside production', () => {
    expect(parseAppRuntimeRole(undefined, 'development')).toBe('all');
  });

  it('defaults to web in production', () => {
    expect(parseAppRuntimeRole(undefined, 'production')).toBe('web');
  });

  it('rejects invalid runtime roles', () => {
    expect(() => parseAppRuntimeRole('api', 'development')).toThrow(
      /Invalid APP_RUNTIME_ROLE/,
    );
  });

  it('rejects all in production', () => {
    expect(() => parseAppRuntimeRole('all', 'production')).toThrow(
      /Invalid APP_RUNTIME_ROLE "all" in production/,
    );
  });

  it('derives runtime capabilities from the role', () => {
    expect(shouldServeHttp('web')).toBe(true);
    expect(shouldRunBackgroundWorkers('web')).toBe(false);
    expect(shouldServeHttp('worker')).toBe(false);
    expect(shouldRunBackgroundWorkers('worker')).toBe(true);
    expect(shouldServeHttp('all')).toBe(true);
    expect(shouldRunBackgroundWorkers('all')).toBe(true);
  });
});
