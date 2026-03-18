import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserEmailService } from '../email/email.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: UserEmailService,
  ) {}

  async createFeedback(userId: string, userEmail: string, dto: CreateFeedbackDto) {
    const feedback = await this.prisma.feedback.create({
      data: {
        userId,
        subject: dto.subject,
        message: dto.message,
      },
    });

    // Fire-and-forget: don't block the response for SMTP
    this.emailService
      .sendSupportFeedbackEmail(userEmail, dto.subject, dto.message)
      .catch((err) => this.logger.error('Failed to send feedback email', err));

    return feedback;
  }
}
