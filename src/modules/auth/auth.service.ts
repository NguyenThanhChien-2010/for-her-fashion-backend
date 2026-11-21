import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { AuthTokenType, Prisma, User, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { apiErrorPayload, ErrorCode } from '../../common/errors/api-error';
import {
  AccountResponse,
  ActionResult,
  AuthTokens,
  JwtPayload,
  JwtRefreshPayload,
  toContractStatus,
} from './auth.types';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { EmailRequestDto } from './dto/email-request.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {}

  async register(dto: RegisterDto): Promise<ActionResult> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        apiErrorPayload(
          ErrorCode.CONFLICT,
          'Email đã được đăng ký.',
        ),
      );
    }

    const passwordHash = await this.hashPassword(dto.password);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    let userId = 0;

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName.trim(),
          role: UserRole.CUSTOMER,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: null,
        },
        select: { id: true },
      });
      userId = user.id;
      await tx.authToken.create({
        data: {
          userId,
          type: AuthTokenType.VERIFY_EMAIL,
          tokenHash,
          expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        },
      });
    });

    // Bộ gửi email nhận token thô; database chỉ lưu hash.
    this.events.emit('auth.email_verification', { userId, token: rawToken });
    this.logger.info({ userId }, 'User registered');
    return {
      status: 'PENDING_VERIFICATION',
      message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực.',
    };
  }

  async confirmEmail(rawToken: string): Promise<ActionResult> {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, type: true, usedAt: true, revokedAt: true, expiresAt: true },
    });
    if (
      record?.type !== AuthTokenType.VERIFY_EMAIL ||
      record.usedAt ||
      record.revokedAt ||
      record.expiresAt <= new Date()
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.BAD_REQUEST,
          'Mã xác thực không hợp lệ hoặc đã hết hạn.',
        ),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: { id: record.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!consumed.count) {
        throw new BadRequestException(
          apiErrorPayload(
            ErrorCode.BAD_REQUEST,
            'Mã xác thực không hợp lệ hoặc đã hết hạn.',
          ),
        );
      }
      const verified = await tx.user.updateMany({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
      if (!verified.count) {
        throw new BadRequestException(
          apiErrorPayload(
            ErrorCode.BAD_REQUEST,
            'Tài khoản không còn tồn tại để xác thực email.',
          ),
        );
      }
    });

    return { status: 'COMPLETED', message: 'Xác thực email thành công.' };
  }

  async resendEmailVerification(dto: EmailRequestDto): Promise<ActionResult> {
    // Dùng cùng phản hồi dù email có tồn tại hay không.
    const response: ActionResult = {
      status: 'ACCEPTED',
      message: 'Yêu cầu gửi lại email xác thực đã được ghi nhận.',
    };
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true, status: true },
    });
    if (user && !user.emailVerifiedAt && user.status !== UserStatus.LOCKED) {
      const rawToken = randomBytes(32).toString('hex');
      await this.prisma.$transaction(async (tx) => {
        await tx.authToken.updateMany({
          where: {
            userId: user.id,
            type: AuthTokenType.VERIFY_EMAIL,
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        await tx.authToken.create({
          data: {
            userId: user.id,
            type: AuthTokenType.VERIFY_EMAIL,
            tokenHash: this.hashToken(rawToken),
            expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
          },
        });
      });
      this.events.emit('auth.email_verification', { userId: user.id, token: rawToken });
    }
    return response;
  }

  async login(
    dto: LoginDto,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    const user = await this.findUserByIdentifier(dto.identifier);
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException(
        apiErrorPayload(
          ErrorCode.UNAUTHORIZED,
          'Thông tin đăng nhập không chính xác.',
        ),
      );
    }
    if (user.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'Tài khoản nội bộ không được đăng nhập khu vực khách hàng.',
        ),
      );
    }
    this.assertLoginAllowed(user);
    const tokens = await this.issueTokens(user, {
      deviceInfo,
      ipAddress,
      rememberMe: dto.rememberMe === true,
    });
    await this.writeAuditLog({
      actorId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: String(user.id),
      ip: ipAddress,
    });
    return tokens;
  }

  async adminLogin(
    dto: LoginDto,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    const user = await this.findUserByIdentifier(dto.identifier);
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException(
        apiErrorPayload(
          ErrorCode.UNAUTHORIZED,
          'Thông tin đăng nhập không chính xác.',
        ),
      );
    }
    if (user.role === UserRole.CUSTOMER) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'Tài khoản khách hàng không được đăng nhập khu vực quản trị.',
        ),
      );
    }
    this.assertLoginAllowed(user);
    const tokens = await this.issueTokens(user, {
      deviceInfo,
      ipAddress,
      rememberMe: dto.rememberMe === true,
    });
    await this.writeAuditLog({
      actorId: user.id,
      action: 'ADMIN_LOGIN',
      entityType: 'User',
      entityId: String(user.id),
      ip: ipAddress,
    });
    return tokens;
  }

  async refreshTokens(
    userId: string,
    refreshToken: string,
    tokenId: string,
  ): Promise<AuthTokens> {
    let payload: JwtRefreshPayload;
    try {
      payload = this.jwtService.verify<JwtRefreshPayload>(refreshToken, {
        secret: this.refreshSecret(),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException(
        apiErrorPayload(
          ErrorCode.UNAUTHORIZED,
          'Refresh token không hợp lệ hoặc đã hết hạn.',
        ),
      );
    }
    if (
      payload.type !== 'refresh' ||
      payload.sub !== userId ||
      payload.tokenId !== tokenId
    ) {
      throw new UnauthorizedException(
        apiErrorPayload(ErrorCode.UNAUTHORIZED, 'Refresh token không hợp lệ.'),
      );
    }

    const sessionId = this.parseSessionId(tokenId);
    const numericUserId = this.parseUserId(userId);
    if (sessionId === null || numericUserId === null) {
      throw new UnauthorizedException(
        apiErrorPayload(ErrorCode.UNAUTHORIZED, 'Refresh token không hợp lệ.'),
      );
    }

    const stored = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (
      stored?.userId !== numericUserId ||
      stored.expiresAt <= new Date() ||
      stored.revokedAt ||
      stored.refreshTokenHash !== this.hashToken(refreshToken)
    ) {
      // Token không còn hợp lệ trong session sẽ thu hồi mọi phiên của tài khoản.
      return this.rejectRefreshReplay(numericUserId);
    }
    if (stored.user.status === UserStatus.LOCKED) {
      throw new UnauthorizedException(
        apiErrorPayload(
          ErrorCode.UNAUTHORIZED,
          'Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ.',
        ),
      );
    }

    // Token mới vẫn hết hạn theo mốc gốc của session.
    const remainingTtlMs = stored.expiresAt.getTime() - Date.now();
    const accessToken = this.signAccess(stored.user, String(stored.id));
    const replacement = this.signRefresh(
      String(stored.user.id),
      String(stored.id),
      remainingTtlMs,
    );

    // So sánh hash cũ để chỉ một request refresh đồng thời thắng.
    const rotationSucceeded = await this.prisma.$transaction(async (tx) => {
      const rotated = await tx.authSession.updateMany({
        where: {
          id: sessionId,
          userId: numericUserId,
          revokedAt: null,
          refreshTokenHash: stored.refreshTokenHash,
        },
        data: {
          refreshTokenHash: this.hashToken(replacement),
          rotatedAt: new Date(),
        },
      });
      return rotated.count > 0;
    });
    if (!rotationSucceeded) {
      return this.rejectRefreshReplay(numericUserId);
    }

    return {
      accessToken,
      refreshToken: replacement,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds(),
      account: this.toAccount(stored.user),
    };
  }

  async logout(userId: string, sessionId?: string): Promise<void> {
    const numericUserId = this.parseUserId(userId);
    if (numericUserId === null) return;
    const numericSessionId = sessionId ? this.parseSessionId(sessionId) : null;
    if (numericSessionId !== null) {
      await this.prisma.authSession.updateMany({
        where: { id: numericSessionId, userId: numericUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.writeAuditLog({
        actorId: numericUserId,
        action: 'LOGOUT',
        entityType: 'AuthSession',
        entityId: String(numericSessionId),
      });
      return;
    }
    await this.prisma.authSession.updateMany({
      where: { userId: numericUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.writeAuditLog({
      actorId: numericUserId,
      action: 'LOGOUT_ALL',
      entityType: 'User',
      entityId: String(numericUserId),
    });
  }

  async forgotPassword(dto: EmailRequestDto): Promise<ActionResult> {
    const response: ActionResult = {
      status: 'ACCEPTED',
      message: 'Yêu cầu đã được ghi nhận.',
    };
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) {
      const rawToken = randomBytes(32).toString('hex');
      await this.prisma.$transaction(async (tx) => {
        await tx.authToken.updateMany({
          where: {
            userId: user.id,
            type: AuthTokenType.RESET_PASSWORD,
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        await tx.authToken.create({
          data: {
            userId: user.id,
            type: AuthTokenType.RESET_PASSWORD,
            tokenHash: this.hashToken(rawToken),
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
          },
        });
      });
      // Bộ gửi email nhận token thô; database chỉ lưu hash.
      this.events.emit('auth.password_reset', { userId: user.id, token: rawToken });
    }
    return response;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<ActionResult> {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException(
        apiErrorPayload(ErrorCode.VALIDATION_ERROR, 'Dữ liệu đầu vào không hợp lệ.', [
          { field: 'passwordConfirmation', message: 'Mật khẩu xác nhận không khớp.' },
        ]),
      );
    }

    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hashToken(dto.token) },
      select: { id: true, userId: true, type: true, usedAt: true, revokedAt: true, expiresAt: true },
    });
    if (
      record?.type !== AuthTokenType.RESET_PASSWORD ||
      record.usedAt ||
      record.revokedAt ||
      record.expiresAt <= new Date()
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.BAD_REQUEST,
          'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
        ),
      );
    }

    const hash = await this.hashPassword(dto.password);
    // Đổi mật khẩu, tiêu thụ token và thu hồi phiên phải cùng thành công.
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: { id: record.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!consumed.count) {
        throw new BadRequestException(
          apiErrorPayload(
            ErrorCode.BAD_REQUEST,
            'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
          ),
        );
      }
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash: hash, version: { increment: 1 } },
      });
      await tx.authSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.writeAuditLog({
      actorId: record.userId,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: String(record.userId),
    });

    return { status: 'COMPLETED', message: 'Đặt mật khẩu mới thành công.' };
  }

  async getAccount(userId: string): Promise<AccountResponse> {
    const numericUserId = this.parseUserId(userId);
    if (numericUserId === null) {
      throw new NotFoundException(
        apiErrorPayload(ErrorCode.NOT_FOUND, 'Không tìm thấy tài khoản.'),
      );
    }
    const user = await this.prisma.user.findUnique({ where: { id: numericUserId } });
    if (!user) {
      throw new NotFoundException(
        apiErrorPayload(ErrorCode.NOT_FOUND, 'Không tìm thấy tài khoản.'),
      );
    }
    return this.toAccount(user);
  }

  toAccount(user: User): AccountResponse {
    return {
      id: String(user.id),
      fullName: user.fullName,
      email: user.email,
      ...(user.phone ? { phone: user.phone } : {}),
      role: user.role,
      status: toContractStatus(user),
      emailVerified: user.emailVerifiedAt !== null,
      version: user.version,
    };
  }

  private findUserByIdentifier(identifier: string): Promise<User | null> {
    const value = identifier.trim();
    if (value.includes('@')) {
      return this.prisma.user.findUnique({ where: { email: value.toLowerCase() } });
    }
    return this.prisma.user.findUnique({ where: { phone: value } });
  }

  private assertLoginAllowed(user: User): void {
    if (user.status === UserStatus.LOCKED) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ.',
        ),
      );
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'Vui lòng xác thực email trước khi đăng nhập.',
        ),
      );
    }
  }

  private async issueTokens(
    user: User,
    options: { deviceInfo?: string; ipAddress?: string; rememberMe: boolean },
  ): Promise<AuthTokens> {
    const sessionTtlMs = this.refreshTtlMs(options.rememberMe);
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.hashToken(randomUUID()),
        expiresAt,
      },
      select: { id: true },
    });

    const accessToken = this.signAccess(user, String(session.id));
    const refreshToken = this.signRefresh(
      String(user.id),
      String(session.id),
      sessionTtlMs,
    );
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { refreshTokenHash: this.hashToken(refreshToken) },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds(),
      account: this.toAccount(user),
    };
  }

  private async revokeActiveSessions(userId: number): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async rejectRefreshReplay(userId: number): Promise<never> {
    await this.revokeActiveSessions(userId);
    throw new UnauthorizedException(
      apiErrorPayload(
        ErrorCode.UNAUTHORIZED,
        'Phát hiện tái sử dụng token. Vui lòng đăng nhập lại.',
      ),
    );
  }

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private accessSecret(): string {
    return (
      this.config.get<string>('JWT_ACCESS_SECRET') ??
      this.config.getOrThrow<string>('JWT_SECRET')
    );
  }

  private refreshSecret(): string {
    return (
      this.config.get<string>('JWT_REFRESH_SECRET') ??
      this.config.get<string>('JWT_ACCESS_SECRET') ??
      this.config.getOrThrow<string>('JWT_SECRET')
    );
  }

  private signAccess(user: User, sessionId: string): string {
    return this.jwtService.sign(
      {
        sub: String(user.id),
        email: user.email,
        role: user.role,
        type: 'access',
        sid: sessionId,
      } satisfies JwtPayload,
      {
        secret: this.accessSecret(),
        algorithm: 'HS256',
        expiresIn: this.accessTtlSeconds(),
      },
    );
  }

  private signRefresh(userId: string, tokenId: string, ttlMs: number): string {
    return this.jwtService.sign(
      { sub: userId, tokenId, type: 'refresh' } satisfies JwtRefreshPayload,
      {
        secret: this.refreshSecret(),
        algorithm: 'HS256',
        expiresIn: Math.max(1, Math.floor(ttlMs / 1000)),
      },
    );
  }

  private async writeAuditLog(entry: {
    actorId?: number | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    after?: Prisma.InputJsonValue;
    ip?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          ...(entry.actorId ? { actorId: entry.actorId } : {}),
          action: entry.action,
          entityType: entry.entityType,
          ...(entry.entityId ? { entityId: entry.entityId.slice(0, 60) } : {}),
          ...(entry.after !== undefined ? { after: entry.after } : {}),
          ...(entry.ip ? { ip: entry.ip.slice(0, 45) } : {}),
        },
      });
    } catch (error) {
      // Audit lỗi không làm đảo ngược nghiệp vụ đã hoàn tất.
      this.logger.warn(
        { action: entry.action, entityId: entry.entityId, error: String(error) },
        'Failed to write audit log',
      );
    }
  }

  private parseUserId(value: string): number | null {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  private parseSessionId(value: string): number | null {
    return this.parseUserId(value);
  }

  private accessTtlSeconds(): number {
    return this.parseDurationSeconds(
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      900,
    );
  }

  private refreshTtlMs(rememberMe: boolean): number {
    if (rememberMe) {
      return (
        this.parseDurationSeconds(
          this.config.get<string>('JWT_REMEMBER_ME_EXPIRES_IN', '30d'),
          (30 * DAY_MS) / 1000,
        ) * 1000
      );
    }
    return (
      this.parseDurationSeconds(
        this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
        (7 * DAY_MS) / 1000,
      ) * 1000
    );
  }

  private parseDurationSeconds(value: string, fallback: number): number {
    const match = /^(\d+)([smhd])?$/.exec(value.trim());
    if (!match) return fallback;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return fallback;
    switch (match[2]) {
      case 'd':
        return amount * 86400;
      case 'h':
        return amount * 3600;
      case 'm':
        return amount * 60;
      default:
        return amount;
    }
  }
}
