import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EMAIL_DELIVERY_SERVICE } from '../../../modules/email/email.interface';
import { ResendEmailService } from './resend-email.service';

@Module({
  imports: [ConfigModule],
  providers: [
    ResendEmailService,
    {
      provide: EMAIL_DELIVERY_SERVICE,
      useExisting: ResendEmailService,
    },
  ],
  exports: [EMAIL_DELIVERY_SERVICE, ResendEmailService],
})
export class ResendEmailModule {}
