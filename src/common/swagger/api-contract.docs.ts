import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'Email không đúng định dạng.' })
  message!: string;
}

export class ApiErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'Dữ liệu đầu vào không hợp lệ.' })
  message!: string;

  @ApiProperty({ type: [FieldErrorDto] })
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
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ example: 'Nguyễn An' })
  fullName!: string;

  @ApiProperty({ example: 'khach@example.com', format: 'email' })
  email!: string;

  @ApiPropertyOptional({ example: '0901234567' })
  phone?: string;

  @ApiProperty({ enum: ['CUSTOMER', 'STAFF', 'ADMIN'], example: 'CUSTOMER' })
  role!: 'CUSTOMER' | 'STAFF' | 'ADMIN';

  @ApiProperty({ enum: ['PENDING_VERIFICATION', 'ACTIVE', 'LOCKED'], example: 'ACTIVE' })
  status!: 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED';

  @ApiProperty({ example: true })
  emailVerified!: boolean;

  @ApiProperty({ example: 3, description: 'Phiên bản đã đọc; backend tăng khi cập nhật thành công.' })
  version!: number;
}

export class AuthTokensDto {
  @ApiProperty({ example: 'access-token-example' })
  accessToken!: string;

  @ApiProperty({ example: 'refresh-token-example' })
  refreshToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 900, description: 'Thời gian sống thực tế của access token theo cấu hình M01.' })
  expiresIn!: number;

  @ApiProperty({ type: AccountDto })
  account!: AccountDto;
}

export class PaginationDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}

export class PaginatedAccountsDto {
  @ApiProperty({ type: [AccountDto] })
  items!: AccountDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

export class UploadDto {
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ enum: ['REVIEW', 'RETURN', 'PRODUCT', 'REFUND_EVIDENCE'], example: 'REVIEW' })
  purpose!: 'REVIEW' | 'RETURN' | 'PRODUCT' | 'REFUND_EVIDENCE';

  @ApiProperty({ enum: ['image/jpeg', 'image/png'], example: 'image/jpeg' })
  mimeType!: 'image/jpeg' | 'image/png';

  @ApiProperty({ example: 120000 })
  sizeBytes!: number;

  @ApiProperty({ enum: ['PRIVATE', 'PUBLIC_AFTER_APPROVAL'], example: 'PRIVATE' })
  access!: 'PRIVATE' | 'PUBLIC_AFTER_APPROVAL';
}

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

export function ApiErrorResponses(
  ...statuses: number[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorEnvelopeDto, ApiErrorBodyDto, FieldErrorDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
      }),
    ),
  );
}
