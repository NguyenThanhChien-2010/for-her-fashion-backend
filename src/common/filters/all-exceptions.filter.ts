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

// Map mọi lỗi về đúng schema ApiError của API Contract v1.0.2:
// { error: { code, message, details }, traceId } + header X-Request-ID.
// Không bao giờ trả stack trace, tên bảng hay mã lỗi nội bộ của Prisma ra client.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<TraceableRequest & Partial<Request>>();
    const mapped = this.mapException(exception);
    const traceId = resolveTraceId(request);

    // Filter có thể chạy trước interceptor (ví dụ lỗi ở guard/pipe) nên phải tự set header.
    if (!response.headersSent) {
      response.setHeader('X-Request-ID', traceId);
      if (mapped.statusCode === HttpStatus.UNAUTHORIZED) response.setHeader('WWW-Authenticate', 'Bearer');
    }

    this.logger.error(
      {
        traceId,
        statusCode: mapped.statusCode,
        errorCode: mapped.code,
        method: request.method,
        path: request.path,
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
      exception instanceof Prisma.PrismaClientInitializationError &&
      exception.errorCode && ['P1001', 'P1002', 'P1017'].includes(exception.errorCode)
    ) {
      return this.dependencyUnavailable(exception.errorCode);
    }
    if (
      exception instanceof Prisma.PrismaClientValidationError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      exception instanceof Prisma.PrismaClientInitializationError
    ) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        message: ErrorMessage.INTERNAL_ERROR,
        details: [],
        internalDetail: exception.name,
      };
    }

    const internalDetail =
      exception instanceof Error ? exception.name : 'Unexpected exception';
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: ErrorMessage.INTERNAL_ERROR,
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

    // Lỗi đã được chuẩn hóa từ validationExceptionFactory hoặc service dùng apiErrorPayload.
    if (isApiErrorPayload(body)) {
      return {
        statusCode,
        code: body.code,
        message: body.message,
        details: body.details ?? [],
        internalDetail: body.code,
      };
    }

    // PayloadTooLargeException từ multer (file > 5 MB): contract dùng BAD_REQUEST cho lỗi đầu vào.
    if (statusCode === HttpStatus.PAYLOAD_TOO_LARGE && exception.message === 'File too large') {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'Tệp tải lên vượt quá dung lượng cho phép.',
        details: [{ field: 'file', message: 'Tệp tối đa 5 MB.' }],
        internalDetail: `${exception.name}: ${exception.message}`,
      };
    }

    // BadRequestException mặc định của ValidationPipe: message là mảng string, không có field.
    // Factory mới đã xử lý trường hợp này; nhánh dưới là lưới an toàn nếu có pipe khác ném mảng thô.
    const rawMessage = payload?.message;
    if (Array.isArray(rawMessage)) {
      return {
        statusCode,
        code: ErrorCode.BAD_REQUEST,
        message: ErrorMessage.BAD_REQUEST,
        details: rawMessage
          .filter((item): item is string => typeof item === 'string')
          .map((message) => ({ field: '', message })),
        internalDetail: 'Validation failed',
      };
    }

    const mapped = this.mapStatus(statusCode);
    return {
      statusCode,
      code: mapped.code,
      // Client nhận thông báo thân thiện; message gốc chỉ vào log để debug.
      message: mapped.message,
      details: [],
      internalDetail: exception.name,
    };
  }

  private mapStatus(statusCode: number): { code: string; message: string } {
    switch (statusCode) {
      case HttpStatus.SERVICE_UNAVAILABLE:
        return { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: ErrorMessage.DEPENDENCY_UNAVAILABLE };
      case HttpStatus.BAD_REQUEST:
        return {
          code: ErrorCode.BAD_REQUEST,
          message: ErrorMessage.BAD_REQUEST,
        };
      case HttpStatus.UNAUTHORIZED:
        return {
          code: ErrorCode.UNAUTHENTICATED,
          message: ErrorMessage.UNAUTHENTICATED,
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
        // 409 mặc định hiếm khi là trùng khóa duy nhất (đã map riêng ở P2002); dùng thông báo trạng thái.
        return {
          code: ErrorCode.CONFLICT,
          message: ErrorMessage.CONFLICT_STATE,
        };
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return {
          code: ErrorCode.BAD_REQUEST,
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
              code: ErrorCode.INTERNAL_ERROR,
              message: ErrorMessage.INTERNAL_ERROR,
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
    const internalDetail = `Prisma ${exception.code}`;
    switch (exception.code) {
      case 'P1001':
      case 'P1002':
      case 'P1017':
      case 'P2024':
        return this.dependencyUnavailable(exception.code);
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
          code: ErrorCode.INTERNAL_ERROR,
          message: ErrorMessage.INTERNAL_ERROR,
          details: [],
          internalDetail,
        };
    }
  }

  private dependencyUnavailable(internalDetail: string) {
    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
      message: ErrorMessage.DEPENDENCY_UNAVAILABLE,
      details: [],
      internalDetail,
    };
  }

  // P2002 meta.target cho biết field trùng; chỉ trả tên field, không trả giá trị để tránh lộ dữ liệu.
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
