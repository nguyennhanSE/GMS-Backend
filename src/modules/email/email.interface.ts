export interface EmailTemplate {
    subject: string;
    html: string;
    text?: string;
}

export interface EmailData {
    to: string;
    from?: string;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
}

export interface IEmailService {
    sendEmail(data: EmailData): Promise<boolean>;
}

export const EMAIL_DELIVERY_SERVICE = Symbol('EMAIL_DELIVERY_SERVICE');
