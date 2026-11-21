import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorMessage = {
  VALIDATION_ERROR: 'Dữ liệu đầu vào không hợp lệ.',
  BAD_REQUEST: 'Dữ liệu đầu vào không hợp lệ.',
  UNAUTHORIZED: 'Phiên đăng nhập không hợp lệ hoặc đã hết hiệu lực.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy tài nguyên.',
  CONFLICT: 'Dữ liệu đã tồn tại trong hệ thống.',
  CONFLICT_STATE: 'Dữ liệu, phiên bản hoặc trạng thái đã thay đổi.',
  BUSINESS_RULE_VIOLATION: 'Không đáp ứng điều kiện nghiệp vụ.',
  RATE_LIMITED: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  INTERNAL_SERVER_ERROR: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
} as const;

export interface FieldErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: FieldErrorDetail[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: FieldErrorDetail[];
  };
  traceId: string;
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldErrorDetail[] {
  const details: FieldErrorDetail[] = [];
  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    for (const message of Object.values(error.constraints ?? {})) {
      details.push({ field: path, message });
    }
    if (error.children?.length) {
      details.push(...flattenValidationErrors(error.children, path));
    }
  }
  return details;
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const details = flattenValidationErrors(errors);
  return new BadRequestException({
    code: ErrorCode.VALIDATION_ERROR,
    message: ErrorMessage.VALIDATION_ERROR,
    details,
  } satisfies ApiErrorPayload);
}

export function apiErrorPayload(
  code: ErrorCodeValue,
  message: string = ErrorMessage[code],
  details: FieldErrorDetail[] = [],
): ApiErrorPayload {
  return { code, message, details };
}

export function isApiErrorPayload(body: unknown): body is ApiErrorPayload {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return typeof candidate.code === 'string' && candidate.code.length > 0;
}
