import { Module } from '@nestjs/common';
import { UserEmailService } from './email.service';
import { NodemailerModule } from '../../libs/integration/nodemailer/nodemailer.module';
import { NotificationEmailListener } from './notification-email.listener';

@Module({
  imports: [NodemailerModule],
  providers: [UserEmailService, NotificationEmailListener],
  exports: [UserEmailService],
})
export class EmailModule {}
