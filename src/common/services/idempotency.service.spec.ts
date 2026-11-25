
import {
  ConflictException,
} from '@nestjs/common';

import {
  Prisma,
} from '@prisma/client';

import {
  PrismaService,
  PrismaTransactionClient,
} from '../database/prisma.service';

import {
  IdempotencyService,
} from './idempotency.service';

const dbError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(
    'DB failure',
    {
      code,
      clientVersion: '6.19.3',
    },
  );

describe('IdempotencyService', () => {
  const rows = {
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const tx = {
    idempotencyKey: rows,
  } as unknown as PrismaTransactionClient;

  const db = {
    $transaction: jest.fn(),
    idempotencyKey: {
      findUnique: jest.fn(),
    },
  };

  let service: IdempotencyService;

  const cached = (
    requestHash: string | null = null,
  ) => ({
    response: {
      id: 'order',
    },
    state: 'COMPLETED',
    requestHash,
    expiresAt: new Date(
      Date.now() + 60_000,
    ),
  });

  beforeEach(() => {
    jest.resetAllMocks();

    rows.findUnique.mockResolvedValue(null);

    rows.create.mockResolvedValue({
      id: 1,
    });

    db.$transaction.mockImplementation(
      (
        fn: (
          client: PrismaTransactionClient,
        ) => Promise<unknown>,
      ) => fn(tx),
    );

    service = new IdempotencyService(
      db as unknown as PrismaService,
    );
  });

  // ==========================================
  // TEST 1: CLAIM KEY
  // ==========================================

  it('1. claims before callback and stores response', async () => {
    const start = Date.now();

    const fn = jest.fn(async () => ({
      statusCode: 201,
      data: {
        id: 'order',
      },
    }));

    await expect(
      service.execute(
        'subject',
        'key',
        'admin.accounts.create',
        fn,
      ),
    ).resolves.toEqual({
      id: 'order',
    });

    const claim =
      rows.create.mock.calls[0][0].data;

    expect(claim).toMatchObject({
      subjectKey: 'subject',
      scope: 'admin.accounts.create',
      key: 'key',
      requestHash: null,
      state: 'PROCESSING',
    });

    expect(
      claim.expiresAt.getTime(),
    ).toBeGreaterThanOrEqual(
      start + 86_400_000,
    );

    expect(
      claim.expiresAt.getTime(),
    ).toBeLessThanOrEqual(
      Date.now() + 86_400_000,
    );

    expect(rows.update).toHaveBeenCalledWith({
      where: {
        id: 1,
      },
      data: {
        state: 'COMPLETED',
        response: {
          id: 'order',
        },
        resourceId: '201',
      },
    });

    expect(
      rows.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      rows.create.mock.invocationCallOrder[0],
    );
  });

  // ==========================================
  // TEST 2: CACHED RESPONSE
  // ==========================================

  it('2. returns cached data without callback', async () => {
    rows.findUnique.mockResolvedValue(
      cached(),
    );

    const fn = jest.fn();

    await expect(
      service.execute(
        's',
        'k',
        'scope',
        fn,
      ),
    ).resolves.toEqual({
      id: 'order',
    });

    expect(fn).not.toHaveBeenCalled();
    expect(rows.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST 3: PROCESSING
  // ==========================================

  it('3. rejects PROCESSING request', async () => {
    rows.findUnique.mockResolvedValue({
      state: 'PROCESSING',
      requestHash: null,
      expiresAt: new Date(
        Date.now() + 60_000,
      ),
    });

    await expect(
      service.execute(
        's',
        'k',
        'scope',
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // ==========================================
  // TEST 4: DUPLICATE CLAIM
  // ==========================================

  it('4. reads winner after P2002', async () => {
    rows.create.mockRejectedValue(
      dbError('P2002'),
    );

    db.idempotencyKey.findUnique
      .mockResolvedValue(
        cached(),
      );

    const fn = jest.fn();

    await expect(
      service.execute(
        's',
        'k',
        'scope',
        fn,
      ),
    ).resolves.toEqual({
      id: 'order',
    });

    expect(fn).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST 5: NO WINNER
  // ==========================================

  it('5. duplicate claim without winner returns conflict', async () => {
    rows.create.mockRejectedValue(
      dbError('P2002'),
    );

    db.idempotencyKey.findUnique
      .mockResolvedValue(null);

    await expect(
      service.execute(
        's',
        'k',
        'scope',
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // ==========================================
  // TEST 6: TRANSACTION CONFLICT
  // ==========================================

  it('6. P2034 returns conflict', async () => {
    db.$transaction.mockRejectedValue(
      dbError('P2034'),
    );

    await expect(
      service.execute(
        's',
        'k',
        'scope',
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // ==========================================
  // TEST 7: UNKNOWN ERROR
  // ==========================================

  it('7. rethrows unexpected database errors', async () => {
    const boom = new Error(
      'connection lost',
    );

    db.$transaction.mockRejectedValue(
      boom,
    );

    await expect(
      service.execute(
        's',
        'k',
        'scope',
        jest.fn(),
      ),
    ).rejects.toThrow(
      'connection lost',
    );
  });

  // ==========================================
  // TEST 8: STORE REQUEST HASH
  // ==========================================

  it('8. stores requestHash when creating claim', async () => {
    const fn = jest.fn(async () => ({
      statusCode: 201,
      data: {
        id: '5',
      },
    }));

    await service.execute(
      '1',
      'new-key',
      'admin.products.variants.create',
      fn,
      'hash-size-L',
    );

    expect(rows.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subjectKey: '1',
        scope:
          'admin.products.variants.create',
        key: 'new-key',
        requestHash: 'hash-size-L',
        state: 'PROCESSING',
      }),
    });
  });

  // ==========================================
  // TEST 9: SAME KEY, SAME HASH
  // ==========================================

  it('9. same key and hash returns cached response', async () => {
    rows.findUnique.mockResolvedValue({
      ...cached('hash-size-L'),
      response: {
        id: '5',
      },
    });

    const fn = jest.fn();

    await expect(
      service.execute(
        '1',
        'same-key',
        'admin.products.variants.create',
        fn,
        'hash-size-L',
      ),
    ).resolves.toEqual({
      id: '5',
    });

    expect(fn).not.toHaveBeenCalled();
    expect(rows.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST 10: SAME KEY, DIFFERENT HASH
  // ==========================================

  it('10. same key but different hash returns 409', async () => {
    rows.findUnique.mockResolvedValue(
      cached('hash-size-L'),
    );

    const fn = jest.fn();

    await expect(
      service.execute(
        '1',
        'same-key',
        'admin.products.variants.create',
        fn,
        'hash-size-M',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'IDEMPOTENCY_KEY_REUSED',
      }),
    });

    expect(fn).not.toHaveBeenCalled();
    expect(rows.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST 11: LEGACY RECORD WITHOUT HASH
  // ==========================================

  it('11. legacy key without hash cannot be reused with hashed request', async () => {
    rows.findUnique.mockResolvedValue(
      cached(null),
    );

    await expect(
      service.execute(
        '1',
        'legacy-key',
        'admin.products.variants.create',
        jest.fn(),
        'hash-size-M',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'IDEMPOTENCY_KEY_REUSED',
      }),
    });
  });

  // ==========================================
  // TEST 12: P2002 WITH DIFFERENT HASH
  // ==========================================

  it('12. P2002 winner with different hash returns 409', async () => {
    rows.create.mockRejectedValue(
      dbError('P2002'),
    );

    db.idempotencyKey.findUnique
      .mockResolvedValue(
        cached('hash-size-L'),
      );

    await expect(
      service.execute(
        '1',
        'same-key',
        'admin.products.variants.create',
        jest.fn(),
        'hash-size-M',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'IDEMPOTENCY_KEY_REUSED',
      }),
    });
  });
});
