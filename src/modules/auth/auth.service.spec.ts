import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthTokenType, User, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

// User mẫu khớp schema Leader: id Int, fullName trên bảng users, emailVerifiedAt thay cho isEmailVerified.
const user = (overrides: Partial<User> = {}): User => ({
  id: 1,
  email: 'a@example.com',
  passwordHash: '',
  fullName: 'Nguyễn An',
  phone: '0901234567',
  role: UserRole.CUSTOMER,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date(),
  lockedReason: null,
  createdBy: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function deps() {
  const tx = {
    user: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    authToken: { create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    authSession: {
      create: jest.fn().mockResolvedValue({ id: 10 }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    authToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    },
    authSession: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 10 }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // AuditLog của Leader ghi thao tác bảo mật; stub để test không chạm DB.
    auditLog: { create: jest.fn().mockResolvedValue({ id: 99 }) },
    $transaction: jest.fn(async (fn: (x: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  // sign nhận (payload, options) để test đọc được expiresIn của từng loại token.
  const jwt = {
    sign: jest.fn((payload: object, options?: Record<string, unknown>) =>
      options ? `${JSON.stringify(payload)}|${String(options.expiresIn ?? '')}` : JSON.stringify(payload),
    ),
    verify: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, string> = {
        JWT_SECRET: 'test-secret-value-32-chars-minimum-x',
        JWT_ACCESS_SECRET: 'access-secret-value-32-chars-minimum-x',
        JWT_REFRESH_SECRET: 'refresh-secret-value-32-chars-minimum',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        JWT_REMEMBER_ME_EXPIRES_IN: '30d',
      };
      return values[key] ?? fallback;
    }),
    getOrThrow: jest.fn(() => 'test-secret-value-32-chars-minimum-x'),
  };
  const events = { emit: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    prisma,
    tx,
    jwt,
    config,
    events,
    logger,
    service: new AuthService(
      prisma as never,
      jwt as never,
      config as never,
      events as never,
      logger as never,
    ),
  };
}

describe('AuthService', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('rejects duplicate registration by email or phone', async () => {
    const d = deps();
    d.prisma.user.findFirst.mockResolvedValue({ id: 1 });
    await expect(
      d.service.register({
        email: user().email,
        password: 'Password1!',
        fullName: 'A',
        phone: '0901234567',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a PENDING_VERIFICATION account with a VERIFY_EMAIL token', async () => {
    const d = deps();
    d.prisma.user.findFirst.mockResolvedValue(null);
    d.tx.user.create.mockResolvedValue({ id: 2 });
    await expect(
      d.service.register({
        email: 'new@example.com',
        password: 'Password1!',
        fullName: 'A',
        phone: '0901234567',
      }),
    ).resolves.toEqual({
      status: 'PENDING_VERIFICATION',
      message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực.',
    });
    expect(d.tx.authToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AuthTokenType.VERIFY_EMAIL, userId: 2 }),
      }),
    );
    expect(d.events.emit).toHaveBeenCalledWith('auth.email_verification', expect.objectContaining({ userId: 2 }));
  });

  it('confirms email by setting emailVerifiedAt and consuming the token', async () => {
    const d = deps();
    d.prisma.authToken.findUnique.mockResolvedValue({
      id: 5,
      userId: 1,
      type: AuthTokenType.VERIFY_EMAIL,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(d.service.confirmEmail('raw-token')).resolves.toEqual({
      status: 'COMPLETED',
      message: 'Xác thực email thành công.',
    });
    expect(d.tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailVerifiedAt: expect.any(Date) } }),
    );
  });

  it('rejects an expired or already used verification token', async () => {
    const d = deps();
    d.prisma.authToken.findUnique.mockResolvedValue({
      id: 5,
      userId: 1,
      type: AuthTokenType.VERIFY_EMAIL,
      usedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(d.service.confirmEmail('raw-token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 403 for an unverified login', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(
      user({ passwordHash: hash, emailVerifiedAt: null }),
    );
    await expect(
      d.service.login({ identifier: user().email, password: 'MatKhauMinhHoa!2026' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a LOCKED account at login', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(
      user({ passwordHash: hash, status: UserStatus.LOCKED }),
    );
    await expect(
      d.service.login({ identifier: user().email, password: 'MatKhauMinhHoa!2026' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a wrong password with 401 UNAUTHORIZED', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    await expect(
      d.service.login({ identifier: user().email, password: 'WrongPassword!1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues Bearer tokens with account payload and creates an AuthSession', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    const tokens = await d.service.login({
      identifier: user().email,
      password: 'MatKhauMinhHoa!2026',
      rememberMe: true,
    });
    expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(tokens.account).toMatchObject({ id: '1', role: 'CUSTOMER', status: 'ACTIVE', version: 1 });
    expect(d.prisma.authSession.create).toHaveBeenCalled();
  });

  // Hồi quy: rememberMe phải kéo dài CẢ AuthSession.expiresAt LẪN TTL của JWT refresh.
  // Trước fix, JWT luôn 7 ngày trong khi DB session 30 ngày -> ngày thứ 8 phiên chết sớm.
  it('applies rememberMe to both the session expiry and the refresh JWT TTL', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    const before = Date.now();
    await d.service.login({
      identifier: user().email,
      password: 'MatKhauMinhHoa!2026',
      rememberMe: true,
    });

    const sessionExpiry = d.prisma.authSession.create.mock.calls[0][0].data.expiresAt as Date;
    // 30 ngày cho rememberMe (cho phép sai số 5 giây khi test chạy).
    expect(sessionExpiry.getTime() - before).toBeGreaterThan(30 * 86_400_000 - 5_000);

    const refreshSignOptions = d.jwt.sign.mock.calls.at(-1)?.[1] as { expiresIn: number };
    expect(refreshSignOptions.expiresIn).toBe(30 * 86_400);
  });

  it('keeps the 7-day refresh TTL when rememberMe is absent', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    await d.service.login({ identifier: user().email, password: 'MatKhauMinhHoa!2026' });
    const refreshSignOptions = d.jwt.sign.mock.calls.at(-1)?.[1] as { expiresIn: number };
    expect(refreshSignOptions.expiresIn).toBe(7 * 86_400);
  });

  it('writes a LOGIN audit entry with the actor and IP', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    await d.service.login(
      { identifier: user().email, password: 'MatKhauMinhHoa!2026' },
      'jest-agent',
      '127.0.0.1',
    );
    expect(d.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'LOGIN', actorId: 1, ip: '127.0.0.1' }),
      }),
    );
  });

  it('does not fail the login when the audit table is unavailable', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    // Audit là quan sát: lỗi ghi audit không được làm hỏng phiên đăng nhập đã tạo.
    d.prisma.auditLog.create.mockRejectedValueOnce(new Error('audit table down'));
    await expect(
      d.service.login({ identifier: user().email, password: 'MatKhauMinhHoa!2026' }),
    ).resolves.toMatchObject({ tokenType: 'Bearer' });
  });

  it('rejects CUSTOMER accounts on the admin login endpoint with 403', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    await expect(
      d.service.adminLogin({ identifier: user().email, password: 'MatKhauMinhHoa!2026' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows STAFF accounts on the admin login endpoint', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash, role: UserRole.STAFF }));
    await expect(
      d.service.adminLogin({ identifier: user().email, password: 'MatKhauMinhHoa!2026' }),
    ).resolves.toMatchObject({ tokenType: 'Bearer' });
  });

  it('looks the account up by phone when identifier is not an email', async () => {
    const d = deps();
    const hash = await argon2.hash('MatKhauMinhHoa!2026', { type: argon2.argon2id });
    d.prisma.user.findUnique.mockResolvedValue(user({ passwordHash: hash }));
    await d.service.login({ identifier: '0901234567', password: 'MatKhauMinhHoa!2026' });
    expect(d.prisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '0901234567' } });
  });

  it('reset password consumes the token and revokes every session in one transaction', async () => {
    const d = deps();
    d.prisma.authToken.findUnique.mockResolvedValue({
      id: 7,
      userId: 1,
      type: AuthTokenType.RESET_PASSWORD,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      d.service.resetPassword({
        token: 'raw',
        password: 'NewPassword1!',
        passwordConfirmation: 'NewPassword1!',
      }),
    ).resolves.toEqual({ status: 'COMPLETED', message: 'Đặt mật khẩu mới thành công.' });
    expect(d.tx.authToken.updateMany).toHaveBeenCalled();
    expect(d.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, revokedAt: null } }),
    );
  });

  it('rejects reset when password confirmation does not match', async () => {
    const d = deps();
    await expect(
      d.service.resetPassword({
        token: 'raw',
        password: 'NewPassword1!',
        passwordConfirmation: 'Other1!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(d.prisma.authToken.findUnique).not.toHaveBeenCalled();
  });

  it('rotates the refresh token in place on the same AuthSession', async () => {
    const d = deps();
    d.jwt.verify.mockReturnValue({ sub: '1', tokenId: '10', type: 'refresh' });
    d.prisma.authSession.findUnique.mockResolvedValue({
      id: 10,
      userId: 1,
      refreshTokenHash: 'hash',
      revokedAt: null,
      rotatedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: user(),
    });
    (d.service as unknown as { hashToken: (v: string) => string }).hashToken = jest.fn(() => 'hash');
    const tokens = await d.service.refreshTokens('1', 'jwt-refresh', '10');
    expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(d.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 10, userId: 1, revokedAt: null }) }),
    );
  });

  // Hồi quy: xoay token KHÔNG được cộng thêm TTL đầy đủ, nếu không phiên sẽ sống vô hạn
  // dù AuthSession.expiresAt vẫn là mốc tuyệt đối ban đầu.
  it('keeps the absolute session deadline when rotating (no TTL extension)', async () => {
    const d = deps();
    const sessionExpiry = new Date(Date.now() + 60_000); // còn đúng 60 giây
    d.jwt.verify.mockReturnValue({ sub: '1', tokenId: '10', type: 'refresh' });
    d.prisma.authSession.findUnique.mockResolvedValue({
      id: 10,
      userId: 1,
      refreshTokenHash: 'hash',
      revokedAt: null,
      rotatedAt: null,
      expiresAt: sessionExpiry,
      user: user(),
    });
    (d.service as unknown as { hashToken: (v: string) => string }).hashToken = jest.fn(() => 'hash');
    await d.service.refreshTokens('1', 'jwt-refresh', '10');

    const refreshSignOptions = d.jwt.sign.mock.calls.at(-1)?.[1] as { expiresIn: number };
    // Chỉ còn ~60 giây, tuyệt đối không phải 7 ngày.
    expect(refreshSignOptions.expiresIn).toBeLessThanOrEqual(60);
    expect(refreshSignOptions.expiresIn).toBeGreaterThan(0);
    // Và không được đẩy expiresAt của phiên ra xa hơn.
    expect(d.tx.authSession.updateMany.mock.calls[0][0].data).not.toHaveProperty('expiresAt');
  });

  it('writes a PASSWORD_RESET audit entry instead of silently changing the hash', async () => {
    const d = deps();
    d.prisma.authToken.findUnique.mockResolvedValue({
      id: 7,
      userId: 1,
      type: AuthTokenType.RESET_PASSWORD,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await d.service.resetPassword({
      token: 'raw',
      password: 'NewPassword1!',
      passwordConfirmation: 'NewPassword1!',
    });
    expect(d.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PASSWORD_RESET', actorId: 1 }),
      }),
    );
  });

  it('writes a LOGOUT audit entry for the revoked session', async () => {
    const d = deps();
    await d.service.logout('1', '10');
    expect(d.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'LOGOUT', entityId: '10' }),
      }),
    );
  });

  it('revokes every session before throwing on refresh replay', async () => {
    const d = deps();
    d.jwt.verify.mockReturnValue({ sub: '1', tokenId: '10', type: 'refresh' });
    d.prisma.authSession.findUnique.mockResolvedValue({
      id: 10,
      userId: 1,
      refreshTokenHash: 'different',
      revokedAt: new Date(),
      rotatedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: user(),
    });
    await expect(d.service.refreshTokens('1', 'jwt-refresh', '10')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(d.prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, revokedAt: null } }),
    );
  });

  it('revokes only the current session on logout when the access token carries sid', async () => {
    const d = deps();
    await d.service.logout('1', '10');
    expect(d.prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 10, userId: 1, revokedAt: null } }),
    );
  });

  it('falls back to revoking all sessions when the access token has no session id', async () => {
    const d = deps();
    await d.service.logout('1');
    expect(d.prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, revokedAt: null } }),
    );
  });

  it('always answers ACCEPTED for unknown password-reset emails', async () => {
    const d = deps();
    d.prisma.user.findUnique.mockResolvedValue(null);
    await expect(d.service.forgotPassword({ email: 'ghost@example.com' })).resolves.toEqual({
      status: 'ACCEPTED',
      message: 'Yêu cầu đã được ghi nhận.',
    });
  });

  it('maps LOCKED status and missing emailVerifiedAt into the contract Account', () => {
    const d = deps();
    expect(d.service.toAccount(user({ status: UserStatus.LOCKED })).status).toBe('LOCKED');
    expect(d.service.toAccount(user({ emailVerifiedAt: null })).status).toBe('PENDING_VERIFICATION');
    const account = d.service.toAccount(user());
    expect(account).not.toHaveProperty('passwordHash');
    expect(account.id).toBe('1');
    expect(account.emailVerified).toBe(true);
  });
});
