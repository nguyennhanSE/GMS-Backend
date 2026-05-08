import { Injectable, Logger } from '@nestjs/common';
import { EmailData, IEmailService } from '../../../modules/email/email.interface';
import { config } from '../../config';

type ResendEmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
};

@Injectable()
export class ResendEmailService implements IEmailService {
  private readonly logger = new Logger(ResendEmailService.name);

  async sendEmail(data: EmailData): Promise<boolean> {
    const apiKey = config.RESEND_API_KEY?.trim();
    const from = data.from?.trim() || config.EMAIL_FROM?.trim();

    if (!apiKey) {
      this.logger.error('Cannot send email: RESEND_API_KEY is not configured', {
        to: data.to,
      });
      return false;
    }

    if (!from) {
      this.logger.error('Cannot send email: EMAIL_FROM is not configured', {
        to: data.to,
      });
      return false;
    }

    const timeoutMs = config.RESEND_EMAIL_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    timeoutId.unref?.();

    const payload: ResendEmailPayload = {
      from,
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.text,
      reply_to: data.replyTo,
    };

    try {
      const response = await fetch(config.RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseBody = await response.text();

      if (!response.ok) {
        this.logger.error('Resend email API request failed', {
          to: data.to,
          from,
          status: response.status,
          body: responseBody,
        });
        return false;
      }

      this.logger.log(`Email sent successfully to ${data.to}`, {
        from,
        status: response.status,
        body: responseBody,
      });
      return true;
    } catch (error) {
      const errorName =
        error && typeof error === 'object' && 'name' in error
          ? String((error as { name?: unknown }).name)
          : undefined;
      const isAbortError = errorName === 'AbortError';
      const errorMessage =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message)
            : 'Unknown error';

      this.logger.error(`Failed to send email to ${data.to}`, {
        error: isAbortError
          ? `Resend email request timed out after ${timeoutMs}ms`
          : errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
