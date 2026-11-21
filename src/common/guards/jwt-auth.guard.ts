import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { apiErrorPayload, ErrorCode } from '../errors/api-error';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(error: unknown, user: TUser): TUser {
    if (error || !user) {
      throw error ??
        new UnauthorizedException(
          apiErrorPayload(
            ErrorCode.UNAUTHORIZED,
            'Phiên đăng nhập không hợp lệ hoặc đã hết hiệu lực.',
          ),
        );
    }
    return user;
  }
}
