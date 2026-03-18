import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { EmailModule } from '../email/email.module';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  imports: [EmailModule],
  controllers: [SupportController],
  providers: [SupportService, PrismaService],
})
export class SupportModule {}
