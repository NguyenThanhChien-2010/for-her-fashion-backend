import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import {
  ApiErrorBody,
  ErrorCode,
  ErrorMessage,
  FieldErrorDetail,
  isApiErrorPayload,
} from '../errors/api-error';
import {
  TraceableRequest,
  resolveTraceId,
} from '../interceptors/transform-response.interceptor';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<TraceableRequest & Partial<Request>>();
    const mapped = this.mapException(exception);
    const traceId = resolveTraceId(request);

    // Giữ chi tiết nội bộ ở log, không gửi stack trace cho client.
    if (!response.headersSent) response.setHeader('X-Request-ID', traceId);

    this.logger.error(
      {
        traceId,
        statusCode: mapped.statusCode,
        errorCode: mapped.code,
        method: request.method,
        url: request.url,
      },
      mapped.internalDetail,
    );

    const body: ApiErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
      },
      traceId,
    };
    response.status(mapped.statusCode).json(body);
  }

  private mapException(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details: FieldErrorDetail[];
    internalDetail: string;
  } {
    if (exception instanceof HttpException) {
      return this.mapHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaError(exception);
    }

    if (
      exception instanceof Prisma.PrismaClientValidationError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      exception instanceof Prisma.PrismaClientInitializationError
    ) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: ErrorMessage.INTERNAL_SERVER_ERROR,
        details: [],
        internalDetail: `Prisma initialization/validation error: ${exception.message}`,
      };
    }

    const internalDetail =
      exception instanceof Error ? exception.message : String(exception);
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: ErrorMessage.INTERNAL_SERVER_ERROR,
      details: [],
      internalDetail,
    };
  }

  private mapHttpException(exception: HttpException): {
    statusCode: number;
    code: string;
    message: string;
    details: FieldErrorDetail[];
    internalDetail: string;
  } {
    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    const payload =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)
        : undefined;

    if (isApiErrorPayload(body)) {
      return {
        statusCode,
        code: body.code,
        message: body.message,
        details: body.details ?? [],
        internalDetail: `${body.code}: ${body.message}`,
      };
    }

    if (statusCode === HttpStatus.PAYLOAD_TOO_LARGE) {
      return {
        statusCode,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Tệp tải lên vượt quá dung lượng cho phép.',
        details: [{ field: 'file', message: 'Tệp tối đa 5 MB.' }],
        internalDetail: `${exception.name}: ${exception.message}`,
      };
    }

    const rawMessage = payload?.message;
    if (Array.isArray(rawMessage)) {
      return {
        statusCode,
        code: ErrorCode.VALIDATION_ERROR,
        message: ErrorMessage.VALIDATION_ERROR,
        details: rawMessage
          .filter((item): item is string => typeof item === 'string')
          .map((message) => ({ field: '', message })),
        internalDetail: `Validation failed: ${rawMessage.join('; ')}`,
      };
    }

    const detail = typeof rawMessage === 'string' ? rawMessage : exception.message;
    const mapped = this.mapStatus(statusCode);
    return {
      statusCode,
      code: mapped.code,
      message: mapped.message,
      details: [],
      internalDetail: `${exception.name}: ${detail}`,
    };
  }

  private mapStatus(statusCode: number): { code: string; message: string } {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return {
          code: ErrorCode.BAD_REQUEST,
          message: ErrorMessage.BAD_REQUEST,
        };
      case HttpStatus.UNAUTHORIZED:
        return {
          code: ErrorCode.UNAUTHORIZED,
          message: ErrorMessage.UNAUTHORIZED,
        };
      case HttpStatus.FORBIDDEN:
        return {
          code: ErrorCode.FORBIDDEN,
          message: ErrorMessage.FORBIDDEN,
        };
      case HttpStatus.NOT_FOUND:
        return {
          code: ErrorCode.NOT_FOUND,
          message: ErrorMessage.NOT_FOUND,
        };
      case HttpStatus.CONFLICT:
        return {
          code: ErrorCode.CONFLICT,
          message: ErrorMessage.CONFLICT_STATE,
        };
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Tệp tải lên vượt quá dung lượng cho phép.',
        };
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return {
          code: ErrorCode.BUSINESS_RULE_VIOLATION,
          message: ErrorMessage.BUSINESS_RULE_VIOLATION,
        };
      case HttpStatus.TOO_MANY_REQUESTS:
        return {
          code: ErrorCode.RATE_LIMITED,
          message: ErrorMessage.RATE_LIMITED,
        };
      default:
        return statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
          ? {
              code: ErrorCode.INTERNAL_SERVER_ERROR,
              message: ErrorMessage.INTERNAL_SERVER_ERROR,
            }
          : {
              code: ErrorCode.BAD_REQUEST,
              message: STATUS_CODES[statusCode] ?? ErrorMessage.BAD_REQUEST,
            };
    }
  }

  private mapPrismaError(exception: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    code: string;
    message: string;
    details: FieldErrorDetail[];
    internalDetail: string;
  } {
    const internalDetail = `Prisma ${exception.code}: ${exception.message}`;
    switch (exception.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: 'Dữ liệu đã tồn tại trong hệ thống.',
          details: this.uniqueTargetDetails(exception),
          internalDetail,
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: ErrorCode.NOT_FOUND,
          message: 'Không tìm thấy tài nguyên.',
          details: [],
          internalDetail,
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.BAD_REQUEST,
          message: 'Dữ liệu tham chiếu không hợp lệ.',
          details: [],
          internalDetail,
        };
      case 'P2034':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: ErrorMessage.CONFLICT_STATE,
          details: [],
          internalDetail,
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: ErrorMessage.INTERNAL_SERVER_ERROR,
          details: [],
          internalDetail,
        };
    }
  }

  private uniqueTargetDetails(
    exception: Prisma.PrismaClientKnownRequestError,
  ): FieldErrorDetail[] {
    const target = exception.meta?.target;
    const fields: string[] = Array.isArray(target)
      ? target.filter((item): item is string => typeof item === 'string')
      : [];
    if (!Array.isArray(target) && typeof target === 'string') fields.push(target);
    return fields.map((field) => ({
      field,
      message: 'Giá trị này đã được sử dụng.',
    }));
  }
}
