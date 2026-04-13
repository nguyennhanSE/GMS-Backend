import { Injectable, Logger } from '@nestjs/common';
import { NodemailerService } from '../../libs/integration/nodemailer/nodemailer.service';
import { SendEmailDto } from './dto/email.dto';
import { config } from '../../libs/config';

export interface NotificationEmailRecipient {
  id: string;
  name: string;
  email: string;
}

export interface VerificationEmailRecipient {
  id: string;
  name: string;
  email: string;
}

type VerificationEmailOptions = {
  requiresPasswordSetup: boolean;
};

@Injectable()
export class UserEmailService {
  private readonly logger = new Logger(UserEmailService.name);
  private static readonly NOTIFICATION_EMAIL_TIMEOUT_MS = 5000;

  constructor(private readonly nodemailerService: NodemailerService) { }

  async sendWelcomeEmail(user: SendEmailDto, plainPassword: string): Promise<boolean> {
    try {
      this.logger.log(`Sending welcome email to ${user.email}`, { userId: user.id, name: user.name });

      const subject = 'Welcome to Liflow - Your Account Has Been Created';
      const html = this.getWelcomeEmailTemplate(user, plainPassword);
      const text = this.getWelcomeEmailText(user, plainPassword);

      const result = await this.nodemailerService.sendEmail({
        to: user.email,
        subject,
        html,
        text,
      });

      if (result) {
        this.logger.log(`Welcome email sent successfully to ${user.email}`);
      } else {
        this.logger.error(`Failed to send welcome email to ${user.email}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error sending welcome email to ${user.email}`, error);
      return false;
    }
  }

  async sendUserUpdatedEmail(user: SendEmailDto, changes: string[]): Promise<boolean> {
    try {
      this.logger.log(`Sending user updated email to ${user.email}`, { userId: user.id, changes });

      const subject = 'Your Account Has Been Updated - Liflow';
      const html = this.getUserUpdatedEmailTemplate(user, changes);
      const text = this.getUserUpdatedEmailText(user, changes);

      const result = await this.nodemailerService.sendEmail({
        to: user.email,
        subject,
        html,
        text,
      });

      if (result) {
        this.logger.log(`User updated email sent successfully to ${user.email}`);
      } else {
        this.logger.error(`Failed to send user updated email to ${user.email}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error sending user updated email to ${user.email}`, error);
      return false;
    }
  }

  async sendPasswordChangedEmail(user: SendEmailDto): Promise<boolean> {
    try {
      this.logger.log(`Sending password changed email to ${user.email}`, { userId: user.id });

      const subject = 'Your Password Has Been Changed - Liflow';
      const html = this.getPasswordChangedEmailTemplate(user);
      const text = this.getPasswordChangedEmailText(user);

      const result = await this.nodemailerService.sendEmail({
        to: user.email,
        subject,
        html,
        text,
      });

      if (result) {
        this.logger.log(`Password changed email sent successfully to ${user.email}`);
      } else {
        this.logger.error(`Failed to send password changed email to ${user.email}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error sending password changed email to ${user.email}`, error);
      return false;
    }
  }

  async sendAccountVerificationEmail(
    user: VerificationEmailRecipient,
    verificationUrl: string,
    options: VerificationEmailOptions,
  ): Promise<boolean> {
    try {
      this.logger.log(`Sending account verification email to ${user.email}`, {
        userId: user.id,
      });

      const subject = 'Verify Your Liflow Account';
      const html = this.getAccountVerificationEmailTemplate(
        user,
        verificationUrl,
        options,
      );
      const text = this.getAccountVerificationEmailText(
        user,
        verificationUrl,
        options,
      );

      const result = await this.nodemailerService.sendEmail({
        to: user.email,
        subject,
        html,
        text,
      });

      if (result) {
        this.logger.log(
          `Account verification email sent successfully to ${user.email}`,
        );
      } else {
        this.logger.error(
          `Failed to send account verification email to ${user.email}`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error sending account verification email to ${user.email}`,
        error,
      );
      return false;
    }
  }

  async sendNotificationEmail(
    user: NotificationEmailRecipient,
    subject: string,
    message: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`Sending notification email to ${user.email}`, { userId: user.id, subject });

      const html = this.getNotificationEmailTemplate(user, subject, message);
      const text = this.getNotificationEmailText(user, subject, message);

      const result = await this.sendEmailWithTimeout({
        to: user.email,
        subject,
        html,
        text,
      });

      if (result) {
        this.logger.log(`Notification email sent successfully to ${user.email}`);
      } else {
        this.logger.error(`Failed to send notification email to ${user.email}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error sending notification email to ${user.email}`, error);
      return false;
    }
  }

  private getWelcomeEmailTemplate(user: SendEmailDto, plainPassword: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome to Liflow</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .credentials { background-color: #fff; padding: 15px; border-left: 4px solid #4CAF50; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          .warning { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Liflow!</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.name}!</h2>
            <p>Your account has been successfully created by an administrator. Below are your login credentials:</p>
            
            <div class="credentials">
              <h3>Account Information</h3>
              <p><strong>Email:</strong> ${user.email}</p>
              <p><strong>Password:</strong> ${plainPassword}</p>
            </div>

            <div class="warning">
              <strong>Important Security Notice:</strong>
              <ul>
                <li>Please change your password after your first login</li>
                <li>Keep your credentials secure and do not share them</li>
                <li>If you did not request this account, please contact support immediately</li>
              </ul>
            </div>

            <p>You can now log in to the system using the credentials above.</p>
            <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from Liflow System</p>
            <p>Please do not reply to this email</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getWelcomeEmailText(user: SendEmailDto, plainPassword: string): string {
    return `
Welcome to Liflow!

Hello ${user.name}!

Your account has been successfully created by an administrator. Below are your login credentials:

Account Information:
Email: ${user.email}
Password: ${plainPassword}

Important Security Notice:
- Please change your password after your first login
- Keep your credentials secure and do not share them
- If you did not request this account, please contact support immediately

You can now log in to the system using the credentials above.

If you have any questions or need assistance, please don't hesitate to contact our support team.

This is an automated message from Liflow System
Please do not reply to this email
    `;
  }

  private getUserUpdatedEmailTemplate(user: SendEmailDto, changes: string[]): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Account Updated</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2196F3; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          .changes { background-color: #fff; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Account Updated</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.name}!</h2>
            <p>Your account information has been updated by an administrator. The following changes were made:</p>
            
            <div class="changes">
              <h3>Changes Made:</h3>
              <ul>
                ${changes.map(change => `<li>${change}</li>`).join('')}
              </ul>
            </div>

            <p>If you did not request these changes or if you have any concerns, please contact our support team immediately.</p>
            <p>Best regards,<br>Liflow Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message from Liflow System</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getUserUpdatedEmailText(user: SendEmailDto, changes: string[]): string {
    return `
Account Updated - Liflow

Hello ${user.name}!

Your account information has been updated by an administrator. The following changes were made:

${changes.map(change => `• ${change}`).join('\n')}

If you did not request these changes or if you have any concerns, please contact our support team immediately.

Best regards,
Liflow Team

This is an automated message from Liflow System
    `;
  }

  private getPasswordChangedEmailTemplate(user: SendEmailDto): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Password Changed</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #FF9800; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          .warning { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Changed</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.name}!</h2>
            <p>Your password has been changed by an administrator.</p>
            
            <div class="warning">
              <strong>Security Notice:</strong>
              <ul>
                <li>If you did not request this change, please contact support immediately</li>
                <li>For security reasons, we recommend that you change your password again after your next login</li>
                <li>Keep your account credentials secure</li>
              </ul>
            </div>

            <p>Best regards,<br>Liflow Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message from Liflow System</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getPasswordChangedEmailText(user: SendEmailDto): string {
    return `
Password Changed - Liflow

Hello ${user.name}!

Your password has been changed by an administrator.

Security Notice:
- If you did not request this change, please contact support immediately
- For security reasons, we recommend that you change your password again after your next login
- Keep your account credentials secure

Best regards,
Liflow Team

This is an automated message from Liflow System
    `;
  }

  private getAccountVerificationEmailTemplate(
    user: VerificationEmailRecipient,
    verificationUrl: string,
    options: VerificationEmailOptions,
  ): string {
    const intro = options.requiresPasswordSetup
      ? 'Your account has been created by an administrator, but you need to verify your email address and set your password before you can log in.'
      : 'Your account registration has been received. Please verify your email address to activate your account.';
    const action = options.requiresPasswordSetup
      ? 'Please click the button below to open the setup page and finish activating your account:'
      : 'Please click the button below to open the verification page and activate your account:';
    const buttonLabel = options.requiresPasswordSetup
      ? 'Open Password Setup Page'
      : 'Open Verification Page';
    const followUp = options.requiresPasswordSetup
      ? 'Opening the link alone does not activate the account; you must complete password setup on the verification page'
      : 'Opening the link alone does not activate the account; you must confirm activation on the verification page';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Verify Your Account</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white !important; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          .warning { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Your Liflow Account</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.name}!</h2>
            <p>${intro}</p>
            <p>${action}</p>
            <p>
              <a class="button" href="${verificationUrl}">${buttonLabel}</a>
            </p>
            <p>If the button does not work, copy and paste this URL into your browser:</p>
            <p>${verificationUrl}</p>

            <div class="warning">
              <strong>Important:</strong>
              <ul>
                <li>This verification link expires automatically</li>
                <li>${followUp}</li>
                <li>Your account will remain inactive until verification is complete</li>
                <li>If you did not expect this account, you can ignore this email</li>
              </ul>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated message from Liflow System</p>
            <p>Please do not reply to this email</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getAccountVerificationEmailText(
    user: VerificationEmailRecipient,
    verificationUrl: string,
    options: VerificationEmailOptions,
  ): string {
    const intro = options.requiresPasswordSetup
      ? 'Your account has been created by an administrator, but you need to verify your email address and set your password before you can log in.'
      : 'Your account registration has been received. Please verify your email address to activate your account.';
    const action = options.requiresPasswordSetup
      ? 'Open this link to review the verification request and set your password:'
      : 'Open this link to review the verification request and activate your account:';
    const followUp = options.requiresPasswordSetup
      ? 'Opening the link alone does not activate the account; you must complete password setup on the verification page'
      : 'Opening the link alone does not activate the account; you must confirm activation on the verification page';

    return `
Verify Your Liflow Account

Hello ${user.name}!

${intro}

${action}
${verificationUrl}

Important:
- This verification link expires automatically
- ${followUp}
- Your account will remain inactive until verification is complete
- If you did not expect this account, you can ignore this email

This is an automated message from Liflow System
Please do not reply to this email
    `;
  }

  private getNotificationEmailTemplate(
    user: NotificationEmailRecipient,
    subject: string,
    message: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${subject}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #9C27B0; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${subject}</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.name}!</h2>
            <p>${message}</p>
            <p>Best regards,<br>Liflow Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message from Liflow System</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getNotificationEmailText(
    user: NotificationEmailRecipient,
    subject: string,
    message: string,
  ): string {
    return `
${subject} - Liflow

Hello ${user.name}!

${message}

Best regards,
Liflow Team

This is an automated message from Liflow System
    `;
  }

  async sendSupportFeedbackEmail(userEmail: string, subject: string, message: string): Promise<boolean> {
    try {
      this.logger.log(`Sending support feedback email to admin`, { userEmail, subject });

      const adminEmail = config.EMAIL_USER;
      const senderEmail = config.EMAIL_FROM?.trim() || adminEmail;
      if (!adminEmail) {
        this.logger.error('Cannot send support feedback: EMAIL_USER not configured');
        return false;
      }

      const emailSubject = `[Support Feedback] ${subject}`;
      const html = this.getSupportFeedbackEmailTemplate(userEmail, subject, message);
      const text = this.getSupportFeedbackEmailText(userEmail, subject, message);

      const result = await this.nodemailerService.sendEmail({
        to: adminEmail,
        from: senderEmail,
        replyTo: userEmail,
        subject: emailSubject,
        html,
        text,
      });

      if (result) {
        this.logger.log(`Support feedback email sent successfully to admin`);
      } else {
        this.logger.error(`Failed to send support feedback email to admin`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error sending support feedback email`, error);
      return false;
    }
  }

  private getSupportFeedbackEmailTemplate(userEmail: string, subject: string, message: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Support Feedback</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #FF5722; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          .message-box { background-color: #fff; padding: 15px; border-left: 4px solid #FF5722; margin: 20px 0; }
          .user-info { background-color: #e3f2fd; padding: 10px; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Support Feedback</h1>
          </div>
          <div class="content">
            <div class="user-info">
              <strong>From:</strong> ${userEmail}
            </div>

            <h3>Subject: ${subject}</h3>

            <div class="message-box">
              <h4>Message:</h4>
              <p>${message}</p>
            </div>

            <p>You can reply directly to <strong>${userEmail}</strong> to respond to this feedback.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from Liflow Support System</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getSupportFeedbackEmailText(userEmail: string, subject: string, message: string): string {
    return `
New Support Feedback - Liflow

From: ${userEmail}
Subject: ${subject}

Message:
${message}

You can reply directly to ${userEmail} to respond to this feedback.

This is an automated message from Liflow Support System
    `;
  }

  private async sendEmailWithTimeout(data: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => {
        this.logger.error(`Notification email timed out for ${data.to}`, {
          subject: data.subject,
        });
        resolve(false);
      }, UserEmailService.NOTIFICATION_EMAIL_TIMEOUT_MS);

      timeoutId.unref?.();
    });

    try {
      return await Promise.race([
        this.nodemailerService.sendEmail(data),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
