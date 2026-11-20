import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  ApiErrorResponses,
  ApiNoContentResponse,
  ApiSuccessResponse,
  ActionResultDto,
  AuthTokensDto,
} from '../../common/swagger/api-contract.docs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { EmailRequestDto } from './dto/email-request.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenDto } from './dto/token.dto';

// HTTP boundary M01 cho khách hàng: register, login, refresh, logout, xác thực email, đặt lại mật khẩu.
// Mọi đường dẫn khớp chính xác API Contract v1.0.2; controller chỉ điều phối, logic nằm trong AuthService.
@ApiTags('M01')
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'm01_post_auth_register',
    summary: 'Đăng ký tài khoản khách hàng',
    description:
      'Tạo tài khoản chờ xác thực (emailVerifiedAt null), phát mã xác thực hạn 24 giờ và băm Argon2id mật khẩu.',
  })
  @ApiSuccessResponse(201, ActionResultDto)
  @ApiErrorResponses(400, 403, 404, 409, 422, 429, 500, 503)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/email-verifications/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'm01_post_auth_email_verifications_confirm',
    summary: 'Xác thực email',
    description:
      'Kích hoạt tài khoản và tiêu thụ mã xác thực trong cùng một giao dịch; không tự đăng nhập.',
  })
  @ApiSuccessResponse(200, ActionResultDto)
  @ApiErrorResponses(400, 403, 404, 409, 422, 429, 500, 503)
  confirmEmail(@Body() dto: TokenDto) {
    return this.authService.confirmEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('auth/email-verifications/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'm01_post_auth_email_verifications_resend',
    summary: 'Gửi lại email xác thực',
    description:
      'Luôn trả thông báo chung để không tiết lộ email có tồn tại; mã mới vô hiệu mã cũ nếu tài khoản đủ điều kiện.',
  })
  @ApiSuccessResponse(202, ActionResultDto, 'Đã tiếp nhận yêu cầu gửi lại email xác thực.')
  @ApiErrorResponses(400, 403, 404, 409, 422, 429, 500, 503)
  resendEmailVerification(@Body() dto: EmailRequestDto) {
    return this.authService.resendEmailVerification(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'm01_post_auth_login',
    summary: 'Đăng nhập khách hàng',
    description: 'Đăng nhập bằng email hoặc số điện thoại (identifier). Trả cặp token và Account.',
  })
  @ApiSuccessResponse(200, AuthTokensDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 422, 429, 500, 503)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.authService.login(
      dto,
      typeof userAgent === 'string' ? userAgent : undefined,
      req.ip,
    );
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiOperation({
    operationId: 'm01_post_auth_refresh',
    summary: 'Làm mới phiên',
    description:
      'Xoay refresh token: kiểm tra chữ ký, session id, trạng thái thu hồi/tài khoản khóa; phát hiện tái sử dụng sẽ thu hồi toàn bộ phiên.',
  })
  @ApiSuccessResponse(200, AuthTokensDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 422, 429, 500, 503)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request & { user: { sub: string; tokenId: string } },
  ) {
    return this.authService.refreshTokens(
      req.user.sub,
      dto.refreshToken,
      req.user.tokenId,
    );
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({
    operationId: 'm01_post_auth_logout',
    summary: 'Đăng xuất và thu hồi phiên',
    description: 'Thu hồi AuthSession của phiên hiện tại. Trả 204, không có body.',
  })
  @ApiNoContentResponse()
  @ApiErrorResponses(400, 401, 403, 404, 409, 422, 429, 500, 503)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    // user.id là Int theo schema Leader; service nhận chuỗi để đồng nhất với contract.
    await this.authService.logout(String(user.id), user.sessionId);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('auth/password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'm01_post_auth_password_forgot',
    summary: 'Yêu cầu đặt lại mật khẩu',
    description:
      'Luôn trả thông báo chung; mã một lần hạn 30 phút. Không tiết lộ email có tồn tại.',
  })
  @ApiSuccessResponse(202, ActionResultDto, 'Đã tiếp nhận yêu cầu đặt lại mật khẩu.')
  @ApiErrorResponses(400, 403, 404, 409, 422, 429, 500, 503)
  forgotPassword(@Body() dto: EmailRequestDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('auth/password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'm01_post_auth_password_reset',
    summary: 'Đặt mật khẩu mới',
    description:
      'Đổi mật khẩu, tiêu thụ mã và thu hồi toàn bộ phiên cũ trong cùng giao dịch; không tự đăng nhập.',
  })
  @ApiSuccessResponse(200, ActionResultDto)
  @ApiErrorResponses(400, 403, 404, 409, 422, 429, 500, 503)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
