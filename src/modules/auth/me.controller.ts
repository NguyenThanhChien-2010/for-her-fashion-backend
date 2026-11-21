import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  AccountDto,
  ApiErrorResponses,
  ApiSuccessResponse,
} from '../../common/swagger/api-contract.docs';
import { AuthService } from './auth.service';

@ApiTags('M01')
@ApiBearerAuth('BearerAuth')
@Controller('me')
export class MeController {
  constructor(private readonly authService: AuthService) {}

  // API: GET /me
  @Get()
  @ApiOperation({
    summary: 'Xem tài khoản hiện tại',
    description: 'Trả Account của người dùng đang đăng nhập theo đúng schema contract.',
  })
  @ApiSuccessResponse(200, AccountDto)
  @ApiErrorResponses(401, 403, 429, 500)
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getAccount(String(user.id));
  }
}
