import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserBannedEvent, USER_EVENTS } from 'src/common/events/user.events';
import { AuthRepository } from '../repositories/auth.repository';
import { AppLogger } from 'src/libs/logger';

@Injectable()
export class UserBannedListener {
  private readonly context = UserBannedListener.name;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly logger: AppLogger,
  ) {}

  @OnEvent(USER_EVENTS.BANNED)
  async handleUserBanned(event: UserBannedEvent): Promise<void> {
    this.logger.debug(`[${this.context}] Received user.banned event`, {
      userId: event.userId,
    });

    try {
      await this.authRepository.removeAllSessionOfUser(event.userId);
      this.logger.debug(`[${this.context}] All sessions wiped for banned user`, {
        userId: event.userId,
      });
    } catch (error) {
      this.logger.error(`[${this.context}] Failed to wipe sessions for banned user`, {
        userId: event.userId,
        error,
      });
    }
  }
}
