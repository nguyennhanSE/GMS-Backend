import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type KeyvRedis from '@keyv/redis';
import {
  APP_CACHE_DEFAULT_TTL_SECONDS,
  APP_CACHE_STATE,
  APP_CACHE_TAG_TTL_SECONDS,
} from './cache.constants';

type RedisTagClient = {
  del: (...keys: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  sAdd: (key: string, ...members: string[]) => Promise<number>;
  sMembers: (key: string) => Promise<string[]>;
};

export type AppCacheState = {
  cache: Cache | null;
  redisStore: KeyvRedis<unknown> | null;
};

@Injectable()
export class AppCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(AppCacheService.name);

  constructor(
    @Inject(APP_CACHE_STATE) private readonly state: AppCacheState,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.state.cache) {
      return;
    }

    try {
      await this.state.cache.disconnect();
    } catch (error) {
      this.logger.warn(this.buildErrorMessage('disconnect', error));
    }
  }

  async remember<T>(
    key: string,
    loader: () => Promise<T>,
    options: { ttlSeconds?: number; tags?: string[] } = {},
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await loader();
    await this.set(key, value, options);
    return value;
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.state.cache) {
      return undefined;
    }

    try {
      return await this.state.cache.get<T>(key);
    } catch (error) {
      this.logger.warn(this.buildErrorMessage(`get(${key})`, error));
      return undefined;
    }
  }

  async set<T>(
    key: string,
    value: T,
    options: { ttlSeconds?: number; tags?: string[] } = {},
  ): Promise<void> {
    if (!this.state.cache) {
      return;
    }

    const ttl = this.toMilliseconds(options.ttlSeconds);

    try {
      await this.state.cache.set(key, value, ttl);
    } catch (error) {
      this.logger.warn(this.buildErrorMessage(`set(${key})`, error));
      return;
    }

    await this.registerTags(key, options.tags ?? []);
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (!this.state.cache) {
      return;
    }

    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    if (uniqueKeys.length === 0) {
      return;
    }

    try {
      await this.state.cache.mdel(uniqueKeys);
    } catch (error) {
      this.logger.warn(this.buildErrorMessage(`deleteMany(${uniqueKeys.length})`, error));
    }
  }

  async invalidateTags(tags: string[]): Promise<void> {
    const uniqueTags = [...new Set(tags.filter(Boolean))];
    if (uniqueTags.length === 0) {
      return;
    }

    const client = await this.getTagClient();
    if (!client) {
      return;
    }

    for (const tag of uniqueTags) {
      const tagKey = this.buildTagKey(tag);

      try {
        const members = await client.sMembers(tagKey);
        if (members.length > 0) {
          await this.deleteMany(members);
        }

        await client.del(tagKey);
      } catch (error) {
        this.logger.warn(this.buildErrorMessage(`invalidateTag(${tag})`, error));
      }
    }
  }

  private async registerTags(key: string, tags: string[]): Promise<void> {
    const uniqueTags = [...new Set(tags.filter(Boolean))];
    if (uniqueTags.length === 0) {
      return;
    }

    const client = await this.getTagClient();
    if (!client) {
      return;
    }

    for (const tag of uniqueTags) {
      const tagKey = this.buildTagKey(tag);

      try {
        await client.sAdd(tagKey, key);
        await client.expire(tagKey, APP_CACHE_TAG_TTL_SECONDS);
      } catch (error) {
        this.logger.warn(this.buildErrorMessage(`registerTag(${tag})`, error));
      }
    }
  }

  private async getTagClient(): Promise<RedisTagClient | null> {
    if (!this.state.redisStore) {
      return null;
    }

    try {
      return (await this.state.redisStore.getClient()) as unknown as RedisTagClient;
    } catch (error) {
      this.logger.warn(this.buildErrorMessage('getTagClient', error));
      return null;
    }
  }

  private buildTagKey(tag: string): string {
    return `gms:cache-tags:${tag}`;
  }

  private toMilliseconds(ttlSeconds = APP_CACHE_DEFAULT_TTL_SECONDS): number {
    return ttlSeconds * 1000;
  }

  private buildErrorMessage(action: string, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `Cache ${action} failed. Falling back to direct database path. ${detail}`;
  }
}
