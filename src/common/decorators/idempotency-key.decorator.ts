import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { apiErrorPayload, ErrorCode } from '../errors/api-error';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export function readIdempotencyKey(request: Request): string {
  const header = request.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.length < IDEMPOTENCY_KEY_MIN_LENGTH || value.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new BadRequestException(
      apiErrorPayload(ErrorCode.VALIDATION_ERROR, 'Dữ liệu đầu vào không hợp lệ.', [
        {
          field: 'Idempotency-Key',
          message: `Header Idempotency-Key là bắt buộc, dài từ ${IDEMPOTENCY_KEY_MIN_LENGTH} đến ${IDEMPOTENCY_KEY_MAX_LENGTH} ký tự.`,
        },
      ]),
    );
  }
  return value;
}

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    readIdempotencyKey(context.switchToHttp().getRequest<Request>()),
);
