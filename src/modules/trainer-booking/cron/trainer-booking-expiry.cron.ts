import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TrainerBookingService } from '../trainer-booking.service';

@Injectable()
export class TrainerBookingExpiryCronService {
  private readonly logger = new Logger(TrainerBookingExpiryCronService.name);

  constructor(
    private readonly trainerBookingService: TrainerBookingService,
  ) {}

  @Cron('*/5 * * * *')
  async sweepExpiredBookings(): Promise<void> {
    const count = await this.trainerBookingService.expireStaleBookings();
    if (count > 0) {
      this.logger.log(`Expired ${count} stale trainer bookings`);
    }
  }
}
