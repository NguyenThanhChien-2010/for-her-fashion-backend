import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { apiErrorPayload, ErrorCode } from '../errors/api-error';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const { user } = context.switchToHttp().getRequest<{ user?: { role: UserRole } }>();
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException(
        apiErrorPayload(ErrorCode.FORBIDDEN, 'Bạn không có quyền thực hiện thao tác này.'),
      );
    }
    return true;
  }
}
