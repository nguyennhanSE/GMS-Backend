

import { Injectable, Logger } from '@nestjs/common';

@Injectable() // Defaults to Singleton scope, which is correct.
export class AppLogger {
    private readonly debugLog: boolean;

    constructor(
        // The base NestJS Logger instance, injected by the provider.
        private readonly logger: Logger,

    ) {

        console.log(`[AppLogger] Debug logging is ${this.debugLog ? 'ENABLED' : 'DISABLED'}.`);
    }

    // --- Public methods now delegate to the private logMessage method ---

    public error(message: unknown, ...optionalParams: unknown[]): void {
        this.logMessage('error', message, ...optionalParams);
    }

    public warn(message: unknown, ...optionalParams: unknown[]): void {
        this.logMessage('warn', message, ...optionalParams);
    }

    public log(message: unknown, ...optionalParams: unknown[]): void {
        this.logMessage('log', message, ...optionalParams);
    }

    public debug(message: unknown, ...optionalParams: unknown[]): void {
        this.logMessage('debug', message, ...optionalParams);
    }

    /**
     * The core logic for processing and logging messages, adapted from the user's original implementation.
     * This central method ensures all log levels behave identically and consistently.
     */
    private logMessage(
        level: 'log' | 'error' | 'warn' | 'debug',
        message: unknown,
        ...optionalParams: unknown[]
    ): void {

        // Do not proceed if debug logging is disabled in the config.
        // if (!this.debugLog) return;

        // 1. Intelligently find the context.
        // If the last optional parameter is a string, we assume it's the context.
        let context: string | undefined = undefined;
        if (
            optionalParams.length > 0 &&
            typeof optionalParams[optionalParams.length - 1] === 'string'
        ) {
            context = optionalParams.pop() as string;
        }


        const finalMessage = String(message);
        const serializedParams = optionalParams.map((param) => this.serializeParam(param));

        // 4. Call the appropriate method on the injected base logger instance.
        // We pass the context as the last argument, as expected by NestJS's Logger.
        if (context) {
            this.logger[level](finalMessage, ...serializedParams, context);
        } else {
            this.logger[level](finalMessage, ...serializedParams);
        }
    }

    private serializeParam(param: unknown): string {
        if (typeof param === 'string') {
            return param;
        }

        if (param instanceof Error) {
            return param.stack ?? param.message;
        }

        if (param === undefined) {
            return 'undefined';
        }

        try {
            return JSON.stringify(param);
        } catch {
            return Object.prototype.toString.call(param);
        }
    }
}
