import { EventEmitter } from 'events';
import net, { type Server, type Socket } from 'net';

export interface CapturedEmail {
  raw: string;
  headers: Record<string, string>;
}

export interface SmtpTestServerOptions {
  afterDataDelayMs?: number;
}

export class SmtpTestServer {
  private readonly events = new EventEmitter();
  private readonly sockets = new Set<Socket>();
  private readonly options: SmtpTestServerOptions;
  private server?: Server;
  private messages: CapturedEmail[] = [];
  private currentPort?: number;

  constructor(options: SmtpTestServerOptions = {}) {
    this.options = options;
  }

  get port() {
    if (!this.currentPort) {
      throw new Error('SMTP test server has not been started');
    }

    return this.currentPort;
  }

  async start() {
    if (this.server) {
      return;
    }

    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      this.handleConnection(socket);
      socket.once('close', () => {
        this.sockets.delete(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => {
        const address = this.server?.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to determine SMTP test server port'));
          return;
        }

        this.currentPort = address.port;
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async stop() {
    const sockets = [...this.sockets];
    for (const socket of sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    this.currentPort = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  clearMessages() {
    this.messages = [];
  }

  async waitForMessage(timeoutMs = 5_000): Promise<CapturedEmail> {
    if (this.messages.length > 0) {
      return this.messages[this.messages.length - 1];
    }

    return new Promise<CapturedEmail>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.events.off('message', handleMessage);
        reject(new Error(`Timed out waiting for SMTP message after ${timeoutMs}ms`));
      }, timeoutMs);

      const handleMessage = (message: CapturedEmail) => {
        clearTimeout(timeout);
        this.events.off('message', handleMessage);
        resolve(message);
      };

      this.events.on('message', handleMessage);
    });
  }

  private handleConnection(socket: Socket) {
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP Test SMTP\r\n');

    let buffer = '';
    let mode: 'command' | 'data' | 'auth-login-username' | 'auth-login-password' =
      'command';

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      while (buffer.length > 0) {
        if (mode === 'data') {
          const dataTerminatorIndex = buffer.indexOf('\r\n.\r\n');
          if (dataTerminatorIndex === -1) {
            return;
          }

          const rawMessage = buffer.slice(0, dataTerminatorIndex);
          buffer = buffer.slice(dataTerminatorIndex + 5);
          mode = 'command';

          const message = {
            raw: rawMessage,
            headers: parseHeaders(rawMessage),
          };
          this.messages.push(message);
          this.events.emit('message', message);

          const acceptMessage = () => {
            socket.write('250 2.0.0 Message accepted\r\n');
          };

          if ((this.options.afterDataDelayMs ?? 0) > 0) {
            setTimeout(acceptMessage, this.options.afterDataDelayMs);
          } else {
            acceptMessage();
          }

          continue;
        }

        const newlineIndex = buffer.indexOf('\r\n');
        if (newlineIndex === -1) {
          return;
        }

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 2);

        if (mode === 'auth-login-username') {
          mode = 'auth-login-password';
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }

        if (mode === 'auth-login-password') {
          mode = 'command';
          socket.write('235 2.7.0 Authentication successful\r\n');
          continue;
        }

        const upperLine = line.toUpperCase();

        if (upperLine.startsWith('EHLO') || upperLine.startsWith('HELO')) {
          socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
          continue;
        }

        if (upperLine.startsWith('AUTH PLAIN')) {
          socket.write('235 2.7.0 Authentication successful\r\n');
          continue;
        }

        if (upperLine === 'AUTH LOGIN') {
          mode = 'auth-login-username';
          socket.write('334 VXNlcm5hbWU6\r\n');
          continue;
        }

        if (
          upperLine.startsWith('MAIL FROM:') ||
          upperLine.startsWith('RCPT TO:') ||
          upperLine === 'RSET' ||
          upperLine === 'NOOP'
        ) {
          socket.write('250 2.1.0 OK\r\n');
          continue;
        }

        if (upperLine === 'DATA') {
          mode = 'data';
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          continue;
        }

        if (upperLine === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
          return;
        }

        socket.write('250 2.1.5 OK\r\n');
      }
    });
  }
}

function parseHeaders(rawMessage: string) {
  const separatorIndex = rawMessage.indexOf('\r\n\r\n');
  const headerSection =
    separatorIndex === -1 ? rawMessage : rawMessage.slice(0, separatorIndex);
  const unfoldedHeaders = headerSection.replace(/\r\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};

  for (const line of unfoldedHeaders.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = value;
  }

  return headers;
}
