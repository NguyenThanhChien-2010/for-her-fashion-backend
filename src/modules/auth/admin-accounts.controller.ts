import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AccountDto,
  ApiErrorResponses,
  ApiSuccessResponse,
  PaginatedAccountsDto,
} from '../../common/swagger/api-contract.docs';
import { AdminAccountsService } from './admin-accounts.service';
import { AccountQueryDto, AccountRoleUpdateDto, AccountStatusUpdateDto, InternalAccountCreateDto } from './dto/account.dto';

// M01 — quản trị tài khoản.
// Phạm vi quyền theo API Contract v1.0.2: GET cho ADMIN + STAFF (Staff chỉ thấy CUSTOMER),
// POST/PATCH chỉ ADMIN. accountId công bố dạng chuỗi số (^[1-9][0-9]*$) khớp User.id Int autoincrement.
@ApiTags('M01')
@ApiBearerAuth('BearerAuth')
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly adminAccounts: AdminAccountsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Tra cứu tài khoản theo phạm vi quyền',
    description:
      'Staff chỉ xem CUSTOMER. Yêu cầu role nội bộ từ Staff trả 403; backend luôn áp phạm vi.',
  })
  @ApiSuccessResponse(200, PaginatedAccountsDto)
  @ApiErrorResponses(400, 401, 403, 422, 429, 500)
  list(@Query() query: AccountQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adminAccounts.list(query, { id: String(user.id), role: user.role });
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Khóa do client tạo cho một ý định nghiệp vụ (16-128 ký tự). Cùng chủ thể + key + payload trả kết quả cũ; khác payload trả 409.',
    schema: { type: 'string', minLength: 16, maxLength: 128 },
  })
  @ApiOperation({
    summary: 'Tạo tài khoản nội bộ',
    description:
      'Admin tạo tài khoản STAFF/ADMIN; tài khoản dùng được ngay, không qua xác thực email.',
  })
  @ApiSuccessResponse(201, AccountDto)
  @ApiErrorResponses(400, 401, 403, 409, 422, 429, 500)
  create(
    @Body() dto: InternalAccountCreateDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminAccounts.create(dto, idempotencyKey, { id: String(user.id) });
  }

  @Get(':accountId')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Xem tài khoản được phép',
    description: 'Staff chỉ xem khách hàng; không trả mật khẩu/token.',
  })
  @ApiParam({ name: 'accountId', description: 'ID nội bộ dạng chuỗi số.', example: '123' })
  @ApiSuccessResponse(200, AccountDto)
  @ApiErrorResponses(400, 401, 403, 404, 429, 500)
  findOne(@Param('accountId') accountId: string, @CurrentUser() user: AuthenticatedUser) {
    if (!/^[1-9][0-9]*$/.test(accountId)) {
      throw new BadRequestException('ID tài khoản không đúng định dạng.');
    }
    return this.adminAccounts.findOne(accountId, { id: String(user.id), role: user.role });
  }

  @Patch(':accountId/role')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Phân vai trò nội bộ',
    description:
      'Chỉ tài khoản nội bộ; không nâng CUSTOMER thành nội bộ bằng endpoint này. version bắt buộc để chống ghi đè.',
  })
  @ApiParam({ name: 'accountId', description: 'ID nội bộ dạng chuỗi số.', example: '123' })
  @ApiSuccessResponse(200, AccountDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 422, 429, 500)
  updateRole(
    @Param('accountId') accountId: string,
    @Body() dto: AccountRoleUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminAccounts.updateRole(accountId, dto, {
      id: String(user.id),
      role: user.role,
    });
  }

  @Patch(':accountId/status')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Khóa hoặc mở tài khoản',
    description:
      'Khóa (LOCKED) thu hồi toàn bộ phiên và chặn API; mở không khôi phục phiên đã thu hồi. Giữ nguyên lịch sử đơn.',
  })
  @ApiParam({ name: 'accountId', description: 'ID nội bộ dạng chuỗi số.', example: '123' })
  @ApiSuccessResponse(200, AccountDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 422, 429, 500)
  updateStatus(
    @Param('accountId') accountId: string,
    @Body() dto: AccountStatusUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminAccounts.updateStatus(accountId, dto, {
      id: String(user.id),
      role: user.role,
    });
  }
}
