import { AppCacheService, AppCacheState } from './cache.service';

describe('AppCacheService', () => {
  it('falls back to the loader when cache is disabled', async () => {
    const service = new AppCacheService({
      cache: null,
      redisStore: null,
    } as AppCacheState);
    const loader = jest.fn().mockResolvedValue({ id: 'schedule-1' });

    await expect(service.remember('gms:test:key', loader)).resolves.toEqual({
      id: 'schedule-1',
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('treats cache read failures as misses and still returns the database value', async () => {
    const cache = {
      get: jest.fn().mockRejectedValue(new Error('redis unavailable')),
      set: jest.fn().mockResolvedValue(undefined),
      mdel: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AppCacheService({
      cache: cache as any,
      redisStore: null,
    });
    const loader = jest.fn().mockResolvedValue({ id: 'trainer-1' });

    await expect(service.remember('gms:test:key', loader)).resolves.toEqual({
      id: 'trainer-1',
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith('gms:test:key', { id: 'trainer-1' }, 300000);
  });

  it('returns cached values without calling the loader', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue({ id: 'membership-1' }),
      set: jest.fn(),
      mdel: jest.fn(),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AppCacheService({
      cache: cache as any,
      redisStore: null,
    });
    const loader = jest.fn();

    await expect(service.remember('gms:test:key', loader)).resolves.toEqual({
      id: 'membership-1',
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it('invalidates tag members through bounded explicit deletion', async () => {
    const cache = {
      get: jest.fn(),
      set: jest.fn(),
      mdel: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const redisClient = {
      sMembers: jest.fn().mockResolvedValue([
        'gms:class-schedule:detail:schedule-1',
        'gms:trainer:availability:trainer-1',
      ]),
      del: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      sAdd: jest.fn().mockResolvedValue(1),
    };
    const redisStore = {
      getClient: jest.fn().mockResolvedValue(redisClient),
    };
    const service = new AppCacheService({
      cache: cache as any,
      redisStore: redisStore as any,
    });

    await service.invalidateTags(['class-schedule:id:schedule-1']);

    expect(redisClient.sMembers).toHaveBeenCalledWith(
      'gms:cache-tags:class-schedule:id:schedule-1',
    );
    expect(cache.mdel).toHaveBeenCalledWith([
      'gms:class-schedule:detail:schedule-1',
      'gms:trainer:availability:trainer-1',
    ]);
    expect(redisClient.del).toHaveBeenCalledWith(
      'gms:cache-tags:class-schedule:id:schedule-1',
    );
  });
});
