import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';

// Trích user đã được JwtStrategy xác thực và loại passwordHash trước khi đưa vào controller.
// sessionId là id AuthSession gắn với access token hiện tại, dùng cho /auth/logout thu hồi đúng một phiên.
// Schema Leader dùng User.id Int nên id ở đây là number; controller chuyển sang chuỗi khi trả contract.
export type AuthenticatedUser = Omit<User, 'passwordHash'> & {
  sessionId: string;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: User & { sessionId: string } }>();
    if (!user) throw new UnauthorizedException('Authentication required');
    // Bỏ passwordHash khỏi payload trả cho controller.
    return Object.fromEntries(
      Object.entries(user).filter(([key]) => key !== 'passwordHash'),
    ) as AuthenticatedUser;
  },
);
