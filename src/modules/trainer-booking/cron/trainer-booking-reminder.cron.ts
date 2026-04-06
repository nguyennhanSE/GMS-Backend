import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrainerBookingService } from '../trainer-booking.service';

@Injectable()
export class TrainerBookingReminderCronService {
  private readonly logger = new Logger(TrainerBookingReminderCronService.name);

  constructor(
    private readonly trainerBookingService: TrainerBookingService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendUpcomingSessionReminders(): Promise<void> {
    const count = await this.trainerBookingService.sendUpcomingReminders();
    if (count > 0) {
      this.logger.log(`Sent ${count} trainer booking reminder notifications`);
    }
  }
}
