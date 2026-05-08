import http, { type IncomingHttpHeaders } from 'http';

export type ResendTestServerOptions = {
  responseDelayMs?: number;
  statusCode?: number;
  responseBody?: Record<string, unknown>;
};

export type ResendTestMessage = {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
};

export class ResendTestServer {
  private server?: http.Server;
  private messages: ResendTestMessage[] = [];
  private waiters: Array<(message: ResendTestMessage) => void> = [];

  constructor(private readonly options: ResendTestServerOptions = {}) {}

  get url() {
    if (!this.server) {
      throw new Error('Resend test server has not been started');
    }

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to determine Resend test server port');
    }

    return `http://127.0.0.1:${address.port}/emails`;
  }

  async start() {
    this.server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];

      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        const message: ResendTestMessage = {
          path: request.url ?? '',
          headers: request.headers,
          body: rawBody ? JSON.parse(rawBody) : {},
        };

        this.messages.push(message);
        const waiter = this.waiters.shift();
        waiter?.(message);

        const writeResponse = () => {
          response.writeHead(this.options.statusCode ?? 200, {
            'Content-Type': 'application/json',
          });
          response.end(
            JSON.stringify(this.options.responseBody ?? { id: 'email-id' }),
          );
        };

        if (this.options.responseDelayMs) {
          setTimeout(writeResponse, this.options.responseDelayMs);
          return;
        }

        writeResponse();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
  }

  async stop() {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    this.server = undefined;
  }

  clearMessages() {
    this.messages = [];
    this.waiters = [];
  }

  getMessages() {
    return [...this.messages];
  }

  async waitForMessage(timeoutMs = 5_000) {
    if (this.messages.length > 0) {
      return this.messages[0];
    }

    return new Promise<ResendTestMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for Resend message after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.waiters.push((message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
  }
}
