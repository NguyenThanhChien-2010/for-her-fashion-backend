import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

// Mã lỗi nghiệp vụ dùng chung theo API Contract v1.0.2 (schema ApiError).
// BE-02..BE-06 bổ sung mã riêng nhưng vẫn trả cùng envelope { error: { code, message, details }, traceId }.
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// Thông báo thân thiện, không lộ chi tiết nội bộ (tên bảng, câu SQL, stack trace).
export const ErrorMessage = {
  BAD_REQUEST: 'Dữ liệu đầu vào không hợp lệ.',
  UNAUTHENTICATED: 'Phiên đăng nhập không hợp lệ hoặc đã hết hiệu lực.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy tài nguyên.',
  CONFLICT: 'Dữ liệu đã tồn tại trong hệ thống.',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency-Key đã được dùng cho nội dung yêu cầu khác.',
  // 409 không do trùng khóa duy nhất: phiên bản/trạng thái đã đổi hoặc request đang xử lý dở.
  CONFLICT_STATE: 'Dữ liệu, phiên bản hoặc trạng thái đã thay đổi.',
  BUSINESS_RULE_VIOLATION: 'Không đáp ứng điều kiện nghiệp vụ.',
  RATE_LIMITED: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  INTERNAL_ERROR: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
  DEPENDENCY_UNAVAILABLE: 'Dịch vụ phụ thuộc tạm thời không sẵn sàng.',
  VERSION_CONFLICT: 'Phiên bản dữ liệu đã thay đổi.',
} as const;

// Một phần tử trong `error.details` (schema FieldError): field là đường dẫn property, message là lý do.
export interface FieldErrorDetail {
  field: string;
  message: string;
}

// Payload chuẩn của mọi exception do tầng ứng dụng chủ động ném ra.
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

// Duyệt cây ValidationError để lấy đường dẫn đầy đủ dạng items.0.quantity cho từng constraint.
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

// ValidationPipe dùng factory này để ném BadRequestException kèm code/details thay vì mảng message thô.
// Nhờ vậy filter không phải đoán lỗi nào là validation và Swagger hiển thị đúng một schema lỗi duy nhất.
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const details = flattenValidationErrors(errors);
  return new BadRequestException({
    code: ErrorCode.BAD_REQUEST,
    message: ErrorMessage.BAD_REQUEST,
    details,
  } satisfies ApiErrorPayload);
}

// Helper cho service/guard ném lỗi có mã nghiệp vụ mà không phải lặp lại object payload.
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
