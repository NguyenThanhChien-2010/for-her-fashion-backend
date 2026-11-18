import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';
import { IdempotencyService } from './idempotency.service';

const dbError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('DB failure', { code, clientVersion: '6.19.3' });

describe('IdempotencyService', () => {
  const rows = {
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const tx = { idempotencyKey: rows } as unknown as PrismaTransactionClient;
  const db = {
    $transaction: jest.fn(),
    idempotencyKey: { findUnique: jest.fn() },
  };
  let service: IdempotencyService;
  const cached = () => ({
    response: { id: 'order' },
    state: 'COMPLETED',
    expiresAt: new Date(Date.now() + 60_000),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    rows.findUnique.mockResolvedValue(null);
    rows.create.mockResolvedValue({ id: 1 });
    db.$transaction.mockImplementation(
      (fn: (client: PrismaTransactionClient) => Promise<unknown>) => fn(tx),
    );
    service = new IdempotencyService(db as unknown as PrismaService);
  });

  it('claims before callback, shares tx and stores response/state with 24h expiry', async () => {
    const start = Date.now();
    const fn = jest.fn(async () => ({ statusCode: 201, data: { id: 'order' } }));
    await expect(
      service.execute('subject', 'key', 'admin.accounts.create', fn),
    ).resolves.toEqual({ id: 'order' });

    const claim = rows.create.mock.calls[0][0].data;
    expect(claim).toMatchObject({
      subjectKey: 'subject',
      scope: 'admin.accounts.create',
      key: 'key',
      state: 'PROCESSING',
    });
    expect(claim.expiresAt.getTime()).toBeGreaterThanOrEqual(start + 86_400_000);
    expect(claim.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);

    expect(rows.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { state: 'COMPLETED', response: { id: 'order' }, resourceId: '201' },
    });
    // Xóa claim hết hạn phải chạy trước khi chiếm khóa mới.
    expect(rows.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      rows.create.mock.invocationCallOrder[0],
    );
  });

  it('returns cached data for a COMPLETED claim without invoking the callback', async () => {
    rows.findUnique.mockResolvedValue(cached());
    const fn = jest.fn();
    await expect(service.execute('s', 'k', 'scope', fn)).resolves.toEqual({ id: 'order' });
    expect(fn).not.toHaveBeenCalled();
    expect(rows.create).not.toHaveBeenCalled();
  });

  it('rejects a claim still PROCESSING as a conflict', async () => {
    rows.findUnique.mockResolvedValue({ state: 'PROCESSING', expiresAt: new Date(Date.now() + 60_000) });
    await expect(service.execute('s', 'k', 'scope', jest.fn())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reads the winner after a duplicate claim rollback (P2002) without running the loser', async () => {
    rows.create.mockRejectedValue(dbError('P2002'));
    db.idempotencyKey.findUnique.mockResolvedValue(cached());
    const fn = jest.fn();
    await expect(service.execute('s', 'k', 'scope', fn)).resolves.toEqual({ id: 'order' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps a duplicate claim with no winner to a retryable conflict', async () => {
    rows.create.mockRejectedValue(dbError('P2002'));
    db.idempotencyKey.findUnique.mockResolvedValue(null);
    await expect(service.execute('s', 'k', 'scope', jest.fn())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps a write conflict (P2034) to a retryable conflict', async () => {
    db.$transaction.mockRejectedValue(dbError('P2034'));
    await expect(service.execute('s', 'k', 'scope', jest.fn())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rethrows unexpected database errors untouched', async () => {
    const boom = new Error('connection lost');
    db.$transaction.mockRejectedValue(boom);
    await expect(service.execute('s', 'k', 'scope', jest.fn())).rejects.toThrow('connection lost');
  });
});
