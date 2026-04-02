import {
  deserializeCacheEntry,
  hashCacheInput,
  normalizeCacheInput,
  serializeCacheEntry,
  stripDefaultValue,
  stripEmptyValue,
} from './cache.utils';

describe('cache.utils', () => {
  it('normalizes semantically identical query inputs to the same object shape', () => {
    const normalizedA = normalizeCacheInput({
      limit: 10,
      page: 1,
      filter: {
        trainerId: 'trainer-1',
        q: undefined,
      },
    });
    const normalizedB = normalizeCacheInput({
      filter: {
        q: undefined,
        trainerId: 'trainer-1',
      },
      page: 1,
      limit: 10,
    });

    expect(normalizedA).toEqual(normalizedB);
  });

  it('produces the same hash for equivalent inputs with different field ordering', () => {
    const first = hashCacheInput({
      filter: {
        trainerId: 'trainer-1',
        dayOfWeek: 'MON',
      },
      page: 1,
      limit: 10,
    });
    const second = hashCacheInput({
      limit: 10,
      page: 1,
      filter: {
        dayOfWeek: 'MON',
        trainerId: 'trainer-1',
      },
    });

    expect(first).toBe(second);
  });

  it('drops default and empty values before hashing helpers build keys', () => {
    expect(stripDefaultValue('month', 'month')).toBeUndefined();
    expect(stripDefaultValue('week', 'month')).toBe('week');
    expect(stripEmptyValue(undefined)).toBeUndefined();
    expect(stripEmptyValue(null)).toBeUndefined();
    expect(stripEmptyValue('')).toBeUndefined();
    expect(stripEmptyValue('trainer-1')).toBe('trainer-1');
  });

  it('serializes and deserializes cache entries without losing structure', () => {
    const entry = {
      id: 'schedule-1',
      targetDate: new Date('2026-03-31T00:00:00.000Z').toISOString(),
      items: [{ id: 'booking-1', status: 'confirmed' }],
    };

    const serialized = serializeCacheEntry(entry);

    expect(deserializeCacheEntry<typeof entry>(serialized)).toEqual(entry);
  });
});
