import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { BaseError, ValidationException } from '../errors';
import { AppLogger } from '../logger';
import { ResponseModel } from '../models/response';


@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Optional() private readonly httpAdapterHost?: HttpAdapterHost,
    @Optional() private readonly loggerService?: AppLogger,
  ) { }

  public catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse();
    const request = httpContext.getRequest();
    const isClientError =
      exception instanceof HttpException && exception.getStatus() < 500;

    if (this.loggerService) {
      if (isClientError) {
        this.loggerService.warn(`[AllExceptionsFilter]`, exception);
      } else {
        this.loggerService.error(`[AllExceptionsFilter]`, exception);
      }
    } else {
      if (isClientError) {
        console.warn('[AllExceptionsFilter]', exception);
      } else {
        console.error('[AllExceptionsFilter]', exception);
      }
    }

    // Get language from Accept-Language header
    const acceptLanguageHeader = request?.headers?.['accept-language'];
    const acceptLanguage =
      typeof acceptLanguageHeader === 'string' ? acceptLanguageHeader : 'en';
    const language = acceptLanguage.split(',')[0].split('-')[0];

    const { httpStatus, errorPayload } = this.getStandardizedErrorResponse(exception, language);

    const responseModel = new ResponseModel();
    responseModel.setError(errorPayload as any);

    const httpAdapter = this.httpAdapterHost?.httpAdapter;

    if (httpAdapter) {
      httpAdapter.reply(response, responseModel, httpStatus);
      return;
    }

    response.status(httpStatus).json(responseModel);
  }

  private getStandardizedErrorResponse(
    exception: unknown,
    language: string = 'en',
  ): { httpStatus: HttpStatus; errorPayload: object } {
    if (exception instanceof BaseError) {
      // Translate error message using i18n
      
      const originalPayload = exception.toErrorPayload() as any;
      return {
        httpStatus: exception.getStatusCode(),
        errorPayload: {
          ...originalPayload,
          message: exception.message,
        },
      };
    }

    if (exception instanceof ValidationException) {
      // Translate validation error message using i18n
      let translatedMessage: string;

      if (exception.errorCode === 'validation.general') {
        // For generic validation errors, translate the specific message
        translatedMessage = exception.message;
      } else if (exception.errorCode.startsWith('validation.')) {
        // Extract the specific validation type from errorCode (e.g., 'required' from 'validation.required')
        const validationType = exception.errorCode.replace('validation.', '');

        // Try to translate the specific validation message first
        translatedMessage = exception.message;

        // If specific translation fails, try the general validation error message
        if (!translatedMessage || translatedMessage === `validation.${validationType}`) {
          translatedMessage = exception.message;
        }
      } else {
        // For error codes that don't start with 'validation.', try direct translation
        translatedMessage = exception.message;

        // If that fails, try the general validation error
        if (!translatedMessage || translatedMessage === `errors.${exception.errorCode}`) {
          translatedMessage = exception.message;
        }
      }

      // Final fallback to the original exception message
      if (!translatedMessage || translatedMessage === 'validation.error.err') {
            translatedMessage = 'Validation error';
      }
     
      return {
        httpStatus: HttpStatus.BAD_REQUEST,
        errorPayload: {
          statusCode: HttpStatus.BAD_REQUEST,
          message: translatedMessage,
          error: 'ValidationException',
          errorCode: exception.errorCode,
          detail: exception.detail,
        },
      };
    }


    if (exception instanceof HttpException) {
      return {
        httpStatus: exception.getStatus(),
        errorPayload: exception.getResponse() as object,
      };
    }

    if (exception instanceof Error) {
      return {
        httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
        errorPayload: {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
          error: exception.name,
        },
      };
    }

    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      errorPayload: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unexpected and unknown error occurred.',
        error: 'Internal Server Error',
      },
    };
  }
}
