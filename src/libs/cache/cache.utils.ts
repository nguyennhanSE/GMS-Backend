import { createHash } from 'node:crypto';
import { deserialize as deserializeBuffer, serialize as serializeBuffer } from 'node:v8';

type CacheInput =
  | null
  | undefined
  | string
  | number
  | boolean
  | Date
  | CacheInput[]
  | { [key: string]: CacheInput };

type NormalizedCacheInput =
  | null
  | string
  | number
  | boolean
  | NormalizedCacheInput[]
  | { [key: string]: NormalizedCacheInput };

export function normalizeCacheInput(value: CacheInput): NormalizedCacheInput {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCacheInput(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, NormalizedCacheInput>>((accumulator, key) => {
        const current = value[key];
        if (current === undefined) {
          return accumulator;
        }

        accumulator[key] = normalizeCacheInput(current);
        return accumulator;
      }, {});
  }

  return value ?? null;
}

export function hashCacheInput(value: CacheInput): string {
  const normalized = normalizeCacheInput(value);
  return createHash('sha1')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 12);
}

export function stripDefaultValue<T>(
  value: T | undefined,
  defaultValue: T,
): T | undefined {
  return value === defaultValue ? undefined : value;
}

export function stripEmptyValue<T>(
  value: T | null | undefined | '',
): T | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}

export function serializeCacheEntry(value: unknown): string {
  return Buffer.from(serializeBuffer(value)).toString('base64');
}

export function deserializeCacheEntry<T>(value: string): T | undefined {
  if (!value) {
    return undefined;
  }

  return deserializeBuffer(Buffer.from(value, 'base64')) as T;
}

