import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';

// Swagger response dùng đúng envelope của API Contract v1.0.2:
// thành công -> { data, traceId }; lỗi -> { error: { code, message, details }, traceId }.
// Mọi schema được khai báo một lần ở đây để controller không lặp lại khối cấu hình dài.

export class FieldErrorDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'Email không đúng định dạng.' })
  message!: string;
}

export class ApiErrorBodyDto {
  @ApiProperty({ example: 'BAD_REQUEST' })
  code!: string;

  @ApiProperty({ example: 'Dữ liệu đầu vào không hợp lệ.' })
  message!: string;

  @ApiPropertyOptional({ type: [FieldErrorDto] })
  details!: FieldErrorDto[];
}

export class ApiErrorEnvelopeDto {
  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;

  @ApiProperty({ example: 'req-example-001' })
  traceId!: string;
}

export class ActionResultDto {
  @ApiProperty({ enum: ['ACCEPTED', 'COMPLETED', 'PENDING_VERIFICATION'], example: 'ACCEPTED' })
  status!: 'ACCEPTED' | 'COMPLETED' | 'PENDING_VERIFICATION';

  @ApiProperty({ example: 'Yêu cầu đã được ghi nhận.' })
  message!: string;
}

export class AccountDto {
  @ApiProperty({ pattern: '^[1-9][0-9]*$', example: '123' })
  id!: string;

  @ApiProperty({ example: 'Nguyễn An' })
  fullName!: string;

  @ApiPropertyOptional({ example: 'khach@example.com', format: 'email' })
  email!: string;

  @ApiPropertyOptional({ pattern: String.raw`^\+?[0-9]{9,15}$`, example: '0901234567' })
  phone?: string;

  @ApiProperty({ enum: ['CUSTOMER', 'STAFF', 'ADMIN'], example: 'CUSTOMER' })
  role!: 'CUSTOMER' | 'STAFF' | 'ADMIN';

  @ApiProperty({ enum: ['PENDING_VERIFICATION', 'ACTIVE', 'LOCKED'], example: 'ACTIVE' })
  status!: 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED';

  @ApiPropertyOptional({ example: true })
  emailVerified!: boolean;

  @ApiProperty({ type: 'integer', format: 'int64', minimum: 1, example: 3, description: 'Phiên bản đã đọc; backend tăng khi cập nhật thành công.' })
  version!: number;
}

export class AuthTokensDto {
  @ApiProperty({ example: 'access-token-example' })
  accessToken!: string;

  @ApiProperty({ example: 'refresh-token-example' })
  refreshToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ type: 'integer', format: 'int64', minimum: 1, example: 900, description: 'Thời gian sống thực tế của access token theo cấu hình M01.' })
  expiresIn!: number;

  @ApiProperty({ type: AccountDto })
  account!: AccountDto;
}

export class PaginationDto {
  @ApiProperty({ type: 'integer', format: 'int64', minimum: 1, example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', format: 'int64', minimum: 1, maximum: 100, example: 20 })
  limit!: number;

  @ApiProperty({ type: 'integer', format: 'int64', minimum: 0, example: 0 })
  total!: number;
}

export class PaginatedAccountsDto {
  @ApiProperty({ type: [AccountDto] })
  items!: AccountDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

export class UploadDto {
  @ApiProperty({ pattern: '^[1-9][0-9]*$', example: '123' })
  id!: string;

  @ApiProperty({ enum: ['REVIEW', 'RETURN', 'PRODUCT', 'REFUND_EVIDENCE'], example: 'REVIEW' })
  purpose!: 'REVIEW' | 'RETURN' | 'PRODUCT' | 'REFUND_EVIDENCE';

  @ApiProperty({ enum: ['image/jpeg', 'image/png'], example: 'image/jpeg' })
  mimeType!: 'image/jpeg' | 'image/png';

  @ApiProperty({ type: 'integer', format: 'int64', minimum: 0, example: 120000 })
  sizeBytes!: number;

  @ApiProperty({ enum: ['PRIVATE', 'PUBLIC_AFTER_APPROVAL'], example: 'PRIVATE' })
  access!: 'PRIVATE' | 'PUBLIC_AFTER_APPROVAL';
}

// Bọc một model bất kỳ vào envelope { data, traceId } kèm header X-Request-ID.
function successEnvelope(model: Type<unknown> | null): Record<string, unknown> {
  const dataSchema = model ? { $ref: getSchemaPath(model) } : { type: 'object' };
  return {
    type: 'object',
    properties: {
      data: dataSchema,
      traceId: { type: 'string', example: 'req-example-001' },
    },
    required: ['data', 'traceId'],
  };
}

export function ApiSuccessResponse(
  status: number,
  model: Type<unknown> | null,
  description = 'Xử lý thành công.',
): MethodDecorator & ClassDecorator {
  const options: ApiResponseOptions = {
    status,
    description,
    headers: {
      'X-Request-ID': {
        description: 'Mã truy vết của request, dùng để đối chiếu log.',
        schema: { type: 'string' },
      },
    },
    schema: successEnvelope(model),
  };
  return applyDecorators(
    ApiExtraModels(...(model ? [model] : [])),
    ApiResponse(options),
  );
}

export function ApiNoContentResponse(
  description = 'Thao tác đã hoàn tất; không có response body.',
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiResponse({
      status: 204,
      description,
      headers: { 'X-Request-ID': { schema: { type: 'string' } } },
    }),
  );
}

// Khai báo các status được truyền từ controller với cùng schema ApiError.
export function ApiErrorResponses(
  ...statuses: number[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorEnvelopeDto, ApiErrorBodyDto, FieldErrorDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        headers: status === 429
          ? { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } }
          : undefined,
        schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
      }),
    ),
  );
}
