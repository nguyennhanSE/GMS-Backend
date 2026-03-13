export class UserBannedEvent {
  constructor(public readonly userId: string) {}
}

export const USER_EVENTS = {
  BANNED: 'user.banned',
} as const;
