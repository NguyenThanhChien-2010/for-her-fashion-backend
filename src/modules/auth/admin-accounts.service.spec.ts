import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { User, UserRole, UserStatus } from '@prisma/client';
import { AdminAccountsService } from './admin-accounts.service';
import { AuthService } from './auth.service';

function accountRow(overrides: Partial<User> = {}): User {
  return {
    id: 2,
    email: 'target@example.com',
    passwordHash: 'hash',
    fullName: 'Target User',
    phone: '0901234567',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    lockedReason: null,
    createdBy: null,
    version: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function deps() {
  const tx = {
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    authSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  };
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(accountRow()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(accountRow()),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const auth = new AuthService(
    prisma as never,
    { sign: jest.fn() } as never,
    { get: jest.fn(), getOrThrow: jest.fn() } as never,
    { emit: jest.fn() } as never,
    { info: jest.fn() } as never,
  );
  const idempotency = {
    execute: jest.fn(
      async (
        _subject: string,
        _key: string,
        _scope: string,
        fn: (transaction: typeof tx) => Promise<{ statusCode: number; data: unknown }>,
      ) => (await fn(tx)).data,
    ),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    prisma,
    tx,
    logger,
    idempotency,
    service: new AdminAccountsService(
      prisma as never,
      auth,
      idempotency as never,
      logger as never,
    ),
  };
}

const admin = { id: '1', role: UserRole.ADMIN };
const staff = { id: '3', role: UserRole.STAFF };

describe('AdminAccountsService', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('scopes a staff query to CUSTOMER accounts only', async () => {
    const d = deps();
    await d.service.list({}, staff);
    expect(d.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: UserRole.CUSTOMER } }),
    );
  });

  it('blocks staff from filtering internal roles', async () => {
    const d = deps();
    await expect(d.service.list({ role: 'ADMIN' }, staff)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns pagination metadata matching the contract schema', async () => {
    const d = deps();
    d.prisma.user.findMany.mockResolvedValue([accountRow()]);
    d.prisma.user.count.mockResolvedValue(1);
    const result = await d.service.list({ page: 2, limit: 20 }, admin);
    expect(result).toEqual({
      items: [expect.objectContaining({ id: '2', status: 'ACTIVE', version: 3 })],
      pagination: { page: 2, limit: 20, total: 1 },
    });
  });

  it('turns a keyword into a fullName/email/phone OR filter', async () => {
    const d = deps();
    await d.service.list({ q: 'Nguyễn' }, admin);
    expect(d.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { contains: 'Nguyễn' } },
            { fullName: { contains: 'Nguyễn' } },
            { phone: { contains: 'Nguyễn' } },
          ],
        },
      }),
    );
  });

  it('removes sessions atomically and writes an audit row when an admin locks an account', async () => {
    const d = deps();
    await d.service.updateStatus(
      '2',
      { version: 3, status: 'LOCKED', reason: 'Gian lận' },
      admin,
    );
    expect(d.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 2, version: 3 },
      data: {
        status: UserStatus.LOCKED,
        version: { increment: 1 },
        lockedReason: 'Gian lận',
      },
    });
    expect(d.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 2, revokedAt: null } }),
    );
    expect(d.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'STATUS_UPDATE', entityId: '2' }),
      }),
    );
  });

  it('does not revoke sessions when unlocking an account', async () => {
    const d = deps();
    d.prisma.user.findUnique.mockResolvedValue(accountRow({ status: UserStatus.LOCKED }));
    await d.service.updateStatus('2', { version: 3, status: 'ACTIVE', reason: 'Khiếu nại đúng' }, admin);
    expect(d.tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale version instead of overwriting a newer change', async () => {
    const d = deps();
    await expect(
      d.service.updateStatus('2', { version: 2, status: 'LOCKED', reason: 'x' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(d.tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('reports CONFLICT when the row version changed between read and write', async () => {
    const d = deps();
    d.tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      d.service.updateStatus('2', { version: 3, status: 'LOCKED', reason: 'x' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents an admin from locking their own account', async () => {
    const d = deps();
    await expect(
      d.service.updateStatus('1', { version: 3, status: 'LOCKED', reason: 'x' }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to promote a CUSTOMER through the internal role endpoint', async () => {
    const d = deps();
    d.prisma.user.findUnique.mockResolvedValue(accountRow({ role: UserRole.CUSTOMER }));
    await expect(
      d.service.updateRole('2', { version: 3, role: 'STAFF', reason: 'x' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps role ADMIN/STAFF to the prisma enum and increments version', async () => {
    const d = deps();
    await d.service.updateRole('2', { version: 3, role: 'ADMIN', reason: 'Bổ nhiệm' }, admin);
    expect(d.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 2, version: 3 },
      data: { role: UserRole.ADMIN, version: { increment: 1 } },
    });
  });

  it('hides out-of-scope accounts from staff as 404', async () => {
    const d = deps();
    d.prisma.user.findFirst.mockResolvedValue(null);
    await expect(d.service.findOne('2', staff)).rejects.toBeInstanceOf(NotFoundException);
    expect(d.prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2, role: UserRole.CUSTOMER } }),
    );
  });

  it('rejects a malformed accountId before touching the database', async () => {
    const d = deps();
    await expect(d.service.findOne('abc', admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(d.prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('creates an internal account as ACTIVE and email-verified', async () => {
    const d = deps();
    d.tx.user.create.mockResolvedValue(accountRow({ role: UserRole.ADMIN, createdBy: 1 }));
    const result = await d.service.create(
      {
        fullName: 'Nhân viên mới',
        email: 'new@example.com',
        password: 'MatKhauNoiBo!2026',
        role: 'ADMIN',
      },
      'idempotency-key-123456',
      { id: '1' },
    );
    expect(result.role).toBe(UserRole.ADMIN);
    expect(d.tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: expect.any(Date),
        }),
      }),
    );
    expect(d.tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 1,
        action: 'INTERNAL_ACCOUNT_CREATE',
        entityType: 'User',
        entityId: '2',
        after: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      },
    });
    expect(d.prisma.user.create).not.toHaveBeenCalled();
    expect(d.prisma.user.findFirst).not.toHaveBeenCalled();
    expect(d.idempotency.execute).toHaveBeenCalledWith(
      '1',
      'idempotency-key-123456',
      'admin.accounts.create',
      expect.any(Function),
    );
  });

  it('rejects duplicate email when creating an internal account', async () => {
    const d = deps();
    d.tx.user.findFirst.mockResolvedValue({ id: 99 });
    await expect(
      d.service.create(
        { fullName: 'A', email: 'dup@example.com', password: 'MatKhauNoiBo!2026', role: 'STAFF' },
        'idempotency-key-123456',
        { id: '1' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(d.tx.user.create).not.toHaveBeenCalled();
    expect(d.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
