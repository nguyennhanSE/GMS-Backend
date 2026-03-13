import { createHash } from 'crypto';

/**
 * Deterministic SHA-256 hash for tokens.
 * Use this for refresh tokens that need indexed DB lookups.
 * Do NOT use bcrypt for tokens — bcrypt is non-deterministic (random salt)
 * and requires O(n) comparisons at ~100-300ms each.
 */
export const sha256Hash = (input: string): string => {
  return createHash('sha256').update(input).digest('hex');
};
