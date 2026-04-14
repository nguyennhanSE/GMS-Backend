import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { MembershipPaymentConsumer } from './membership-payment.consumer';
import { MembershipRecalculationService } from './cron-job/membership.cron-job.service';
import { MembershipExpiryNotificationCronService } from './cron-job/membership-expiry-notification.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentModule } from '../payment/payment.module';
import { config } from '../../libs/config';

const membershipCronProviders = config.RUN_BACKGROUND_WORKERS
  ? [MembershipRecalculationService, MembershipExpiryNotificationCronService]
  : [];

@Module({
  imports: [PaymentModule],
  controllers: [MembershipsController, MembershipPaymentConsumer],
  providers: [
    MembershipsService,
    ...membershipCronProviders,
    PrismaService,
  ],
  exports: [MembershipsService],
})
export class MembershipsModule {}
