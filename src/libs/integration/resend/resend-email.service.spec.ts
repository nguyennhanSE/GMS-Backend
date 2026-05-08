import { ResendEmailService } from './resend-email.service';
import { config } from '../../config';

describe('ResendEmailService', () => {
  let service: ResendEmailService;
  let originalFetch: typeof global.fetch;
  const originalConfig = {
    RESEND_API_KEY: config.RESEND_API_KEY,
    RESEND_API_URL: config.RESEND_API_URL,
    RESEND_EMAIL_TIMEOUT_MS: config.RESEND_EMAIL_TIMEOUT_MS,
    EMAIL_FROM: config.EMAIL_FROM,
  };

  beforeEach(() => {
    service = new ResendEmailService();
    originalFetch = global.fetch;
    config.RESEND_API_KEY = 're_test_key';
    config.RESEND_API_URL = 'https://api.resend.com/emails';
    config.RESEND_EMAIL_TIMEOUT_MS = 10_000;
    config.EMAIL_FROM = 'GMS <notifications@example.com>';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    config.RESEND_API_KEY = originalConfig.RESEND_API_KEY;
    config.RESEND_API_URL = originalConfig.RESEND_API_URL;
    config.RESEND_EMAIL_TIMEOUT_MS = originalConfig.RESEND_EMAIL_TIMEOUT_MS;
    config.EMAIL_FROM = originalConfig.EMAIL_FROM;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns true when Resend accepts the email', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }),
    );

    await expect(
      service.sendEmail({
        to: 'member@example.com',
        subject: 'Verify',
        html: '<p>Verify</p>',
      }),
    ).resolves.toBe(true);
  });

  it('maps replyTo to the raw HTTP reply_to property', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }),
    );

    await service.sendEmail({
      to: 'support@example.com',
      from: 'GMS <support@example.com>',
      replyTo: 'member@example.com',
      subject: 'Support',
      html: '<p>Support</p>',
      text: 'Support',
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit & { body: string },
    ];
    const payload = JSON.parse(init.body) as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        from: 'GMS <support@example.com>',
        to: 'support@example.com',
        reply_to: 'member@example.com',
        subject: 'Support',
        html: '<p>Support</p>',
        text: 'Support',
      }),
    );
  });

  it('logs status and body when Resend returns a non-2xx response', async () => {
    const loggerSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ message: 'domain mismatch' }), {
        status: 403,
      }),
    );

    await expect(
      service.sendEmail({
        to: 'member@example.com',
        subject: 'Verify',
        html: '<p>Verify</p>',
      }),
    ).resolves.toBe(false);

    expect(loggerSpy).toHaveBeenCalledWith(
      'Resend email API request failed',
      expect.objectContaining({
        status: 403,
        body: JSON.stringify({ message: 'domain mismatch' }),
      }),
    );
  });

  it('returns false when the Resend request times out', async () => {
    jest.useFakeTimers();
    config.RESEND_EMAIL_TIMEOUT_MS = 25;
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const result = service.sendEmail({
      to: 'member@example.com',
      subject: 'Verify',
      html: '<p>Verify</p>',
    });

    jest.advanceTimersByTime(25);

    await expect(result).resolves.toBe(false);
  });

  it('returns false when required email config is missing', async () => {
    config.RESEND_API_KEY = '';

    await expect(
      service.sendEmail({
        to: 'member@example.com',
        subject: 'Verify',
        html: '<p>Verify</p>',
      }),
    ).resolves.toBe(false);

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
