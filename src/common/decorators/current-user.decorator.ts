import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';

export type AuthenticatedUser = Omit<User, 'passwordHash'> & {
  sessionId: string;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: User & { sessionId: string } }>();
    if (!user) throw new UnauthorizedException('Authentication required');
    return Object.fromEntries(
      Object.entries(user).filter(([key]) => key !== 'passwordHash'),
    ) as AuthenticatedUser;
  },
);
