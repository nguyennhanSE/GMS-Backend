import { Module } from '@nestjs/common';
import { UserEmailService } from './email.service';
import { NodemailerModule } from '../../libs/integration/nodemailer/nodemailer.module';

@Module({
  imports: [NodemailerModule],
  providers: [UserEmailService],
  exports: [UserEmailService],
})
export class EmailModule {}
