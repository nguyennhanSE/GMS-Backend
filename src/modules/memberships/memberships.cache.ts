import { CACHE_TAGS } from '../../libs/cache/cache.constants';

export const MEMBERSHIP_TTL_SECONDS = 900;

export function buildMembershipListKey(): string {
  return 'gms:membership:list';
}

export function buildMembershipDetailKey(membershipId: string): string {
  return `gms:membership:detail:${membershipId}`;
}

export function buildMembershipIdTag(membershipId: string): string {
  return `membership:id:${membershipId}`;
}

export function membershipListTags(): string[] {
  return [CACHE_TAGS.MEMBERSHIP_LIST];
}

export function membershipDetailTags(membershipId: string): string[] {
  return [CACHE_TAGS.MEMBERSHIP_DETAIL, buildMembershipIdTag(membershipId)];
}

export function buildMembershipInvalidationTags(membershipId?: string): string[] {
  const tags = new Set<string>([
    CACHE_TAGS.MEMBERSHIP_LIST,
    CACHE_TAGS.MEMBERSHIP_DETAIL,
  ]);

  if (membershipId) {
    tags.add(buildMembershipIdTag(membershipId));
  }

  return [...tags];
}

