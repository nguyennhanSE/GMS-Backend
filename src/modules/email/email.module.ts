import { Module } from '@nestjs/common';
import { UserEmailService } from './email.service';
import { ResendEmailModule } from '../../libs/integration/resend/resend-email.module';
import { NotificationEmailListener } from './notification-email.listener';

@Module({
  imports: [ResendEmailModule],
  providers: [UserEmailService, NotificationEmailListener],
  exports: [UserEmailService],
})
export class EmailModule {}
