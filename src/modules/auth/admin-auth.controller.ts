import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import {
  ApiErrorResponses,
  ApiSuccessResponse,
  AuthTokensDto,
} from '../../common/swagger/api-contract.docs';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

// POST /admin/auth/login — chỉ STAFF/ADMIN; CUSTOMER bị chặn 403 theo API Contract v1.0.2.
@ApiTags('M01')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đăng nhập quản trị',
    description:
      'Chỉ cấp phiên quản trị cho tài khoản nội bộ đang hoạt động có role STAFF/ADMIN. Khách hàng bị từ chối 403.',
  })
  @ApiSuccessResponse(200, AuthTokensDto)
  @ApiErrorResponses(400, 401, 403, 422, 429, 500)
  adminLogin(@Body() dto: LoginDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.authService.adminLogin(
      dto,
      typeof userAgent === 'string' ? userAgent : undefined,
      req.ip,
    );
  }
}
