import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { JwtStrategy } from './jwt.strategy';

const config = new ConfigService({
  JWT_SECRET: 'access-test-secret-value-32-chars-x',
  JWT_ACCESS_SECRET: 'access-test-secret-value-32-chars-x',
  JWT_REFRESH_SECRET: 'refresh-test-secret-value-32-chars',
});
const payload = { sub: '1', sid: '10', email: 'user@example.com', role: UserRole.CUSTOMER, type: 'access' };
const user = (overrides: Partial<User> = {}): User => ({
  id: 1,
  email: 'user@example.com',
  passwordHash: 'secret-hash',
  fullName: 'Nguyễn An',
  phone: '0901234567',
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date(),
  lockedReason: null,
  createdBy: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function setup(
  record: User | null = user(),
  session: { userId: number; revokedAt: Date | null; expiresAt: Date } | null = {
    userId: 1,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  },
) {
  const findUnique = jest.fn().mockResolvedValue(record);
  const findSession = jest.fn().mockResolvedValue(session);
  return {
    strategy: new JwtStrategy(config, {
      user: { findUnique },
      authSession: { findUnique: findSession },
    } as unknown as PrismaService),
    findUnique,
    findSession,
  };
}

describe('JWT strategies', () => {
  it('rejects LOCKED accounts with an exact 401', async () => {
    const { strategy } = setup(user({ status: UserStatus.LOCKED }));
    await expect(strategy.validate(payload)).rejects.toMatchObject({
      status: 401,
      message: 'Your account has been blocked',
    });
  });

  it('returns the current database role and never passwordHash', async () => {
    const { strategy } = setup();
    const result = await strategy.validate(payload);
    expect(result.role).toBe(UserRole.ADMIN);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.id).toBe(1);
  });

  it('carries the AuthSession sid as sessionId for logout', async () => {
    const { strategy } = setup();
    const result = await strategy.validate(payload);
    expect(result.sessionId).toBe('10');
  });

  it.each([
    ['revoked', { userId: 1, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }],
    ['expired', { userId: 1, revokedAt: null, expiresAt: new Date(Date.now() - 1) }],
    ['owned by another user', { userId: 2, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }],
    ['missing', null],
  ])('rejects an access token for a %s session', async (_label, session) => {
    const { strategy, findUnique } = setup(user(), session);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([null, user({ emailVerifiedAt: null })])(
    'rejects unavailable accounts %#',
    async (record) => {
      await expect(setup(record).strategy.validate(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  it.each([
    null,
    {},
    { ...payload, type: 'refresh' },
    { ...payload, sub: 'abc' },
    { ...payload, sub: '0' },
    { ...payload, sid: undefined },
    { ...payload, sid: '0' },
    { ...payload, sid: 'not-a-number' },
    { ...payload, sid: '9007199254740992' },
    { ...payload, email: null },
    { ...payload, role: 'ROOT' },
  ])('rejects malformed access claims before querying DB %#', async (claims) => {
    const { strategy, findUnique } = setup();
    await expect(strategy.validate(claims)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns only refresh identity and the original body token', () => {
    const strategy = new JwtRefreshStrategy(config);
    expect(
      strategy.validate(
        { body: { refreshToken: 'signed-token' } },
        { sub: '1', tokenId: '10', type: 'refresh', role: 'ADMIN' },
      ),
    ).toEqual({ sub: '1', tokenId: '10', refreshToken: 'signed-token' });
  });

  it.each([
    null,
    {},
    { sub: '1', tokenId: '10', type: 'access' },
    { sub: '1', tokenId: 2, type: 'refresh' },
  ])('rejects malformed refresh claims %#', (claims) => {
    expect(() =>
      new JwtRefreshStrategy(config).validate({ body: { refreshToken: 'token' } }, claims),
    ).toThrow(UnauthorizedException);
  });

  it.each([undefined, '', 5, ['token']])('rejects non-string or empty refresh body %#', (refreshToken) => {
    expect(() =>
      new JwtRefreshStrategy(config).validate(
        { body: { refreshToken } },
        { sub: '1', tokenId: '10', type: 'refresh' },
      ),
    ).toThrow(UnauthorizedException);
  });
});
