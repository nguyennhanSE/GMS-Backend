import { Global, Logger, Module } from '@nestjs/common';
import { createCache, type Cache } from 'cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { config } from '../config';
import { APP_CACHE_DEFAULT_TTL_SECONDS, APP_CACHE_STATE } from './cache.constants';
import {
  deserializeCacheEntry,
  serializeCacheEntry,
} from './cache.utils';
import { AppCacheService, type AppCacheState } from './cache.service';

function buildRedisUrl(): string {
  const credentials =
    config.REDIS_USERNAME || config.REDIS_PASSWORD
      ? `${encodeURIComponent(config.REDIS_USERNAME ?? '')}:${encodeURIComponent(config.REDIS_PASSWORD ?? '')}@`
      : '';

  return `redis://${credentials}${config.REDIS_HOST}:${config.REDIS_PORT}/${config.REDIS_DB}`;
}

function createAppCacheState(): AppCacheState {
  const logger = new Logger('AppCacheModule');

  if (!config.REDIS_ENABLED) {
    logger.log('Redis cache disabled. Using direct database reads.');
    return {
      cache: null,
      redisStore: null,
    };
  }

  try {
    const redisStore = new KeyvRedis(buildRedisUrl(), {
      throwOnConnectError: false,
      throwOnErrors: false,
      connectionTimeout: 2000,
      useUnlink: true,
    });

    const keyv = new Keyv({
      store: redisStore,
      namespace: 'gms-cache',
      ttl: (config.REDIS_TTL_SECONDS ?? APP_CACHE_DEFAULT_TTL_SECONDS) * 1000,
      serialize: serializeCacheEntry,
      deserialize: deserializeCacheEntry,
      throwOnErrors: false,
    });

    const cache = createCache({
      stores: [keyv],
      ttl: (config.REDIS_TTL_SECONDS ?? APP_CACHE_DEFAULT_TTL_SECONDS) * 1000,
    });

    logger.log('Redis cache enabled.');
    return {
      cache,
      redisStore,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Redis cache initialization failed at startup. Falling back to direct database reads. ${detail}`,
    );

    return {
      cache: null,
      redisStore: null,
    };
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_CACHE_STATE,
      useFactory: createAppCacheState,
    },
    AppCacheService,
  ],
  exports: [AppCacheService],
})
export class AppCacheModule {}
