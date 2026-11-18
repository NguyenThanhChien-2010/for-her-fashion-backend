import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
type RefreshRequest = { body?: { refreshToken?: unknown } };

@Injectable()
// Strategy đọc refresh JWT từ body; AuthService tiếp tục kiểm tra hash/tokenId trong AuthSession.
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey:
        config.get<string>('JWT_REFRESH_SECRET') ??
        config.get<string>('JWT_ACCESS_SECRET') ??
        config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      passReqToCallback: true,
    });
  }

  validate(
    req: RefreshRequest,
    payload: unknown,
  ): { sub: string; tokenId: string; refreshToken: string } {
    const refreshToken = req.body?.refreshToken;
    if (!payload || typeof payload !== 'object') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const claims = payload as Record<string, unknown>;
    if (
      claims.type !== 'refresh' ||
      typeof claims.sub !== 'string' ||
      typeof claims.tokenId !== 'string' ||
      typeof refreshToken !== 'string' ||
      !refreshToken
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return { sub: claims.sub, tokenId: claims.tokenId, refreshToken };
  }
}
