import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole, UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: 'access';
  sid: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        config.get<string>('JWT_ACCESS_SECRET') ??
        config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    if (!payload || typeof payload !== 'object') {
      throw new UnauthorizedException('Invalid access token');
    }
    const claims = payload as Record<string, unknown>;
    if (
      claims.type !== 'access' ||
      typeof claims.sub !== 'string' ||
      !/^[1-9]\d*$/.test(claims.sub) ||
      !Number.isSafeInteger(Number(claims.sub)) ||
      typeof claims.sid !== 'string' ||
      !/^[1-9]\d*$/.test(claims.sid) ||
      !Number.isSafeInteger(Number(claims.sid)) ||
      typeof claims.email !== 'string' ||
      !claims.email.trim() ||
      !Object.values(UserRole).includes(claims.role as UserRole)
    ) {
      throw new UnauthorizedException('Invalid access token');
    }

    const userId = Number(claims.sub);
    const sessionId = Number(claims.sid);
    // Đọc trạng thái mới nhất để khóa tài khoản có hiệu lực với token cũ.
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Session is invalid, revoked, or expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status === UserStatus.LOCKED) {
      throw new UnauthorizedException('Your account has been blocked');
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Account is not active or email is not verified');
    }

    const safeUser = Object.fromEntries(
      Object.entries(user).filter(([key]) => key !== 'passwordHash'),
    ) as Omit<typeof user, 'passwordHash'>;
    return { ...safeUser, sessionId: claims.sid };
  }
}
