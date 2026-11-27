import { createHash } from 'node:crypto';
import { Prisma, SyncState } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryAdjustmentService } from './inventory-adjustment.service';

describe('BE-02 M03 InventoryAdjustmentService', () => {
  let service: InventoryAdjustmentService;

  const key = 'M03-ADJUST-TEST-001';
  const actorId = 1;

  const body = {
    variantId: '1',
    version: 3,
    countedQuantity: 8,
    reason: 'Local inventory adjustment test',
  };

  const operationKey = (actor = actorId, token = key) =>
    'M03-ADJUST-' + createHash('sha256')
      .update(JSON.stringify([
        actor,
        'm03_post_admin_inventory_adjustments',
        token,
      ]))
      .digest('hex');

  const makeAdjustment = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 10,
    variantId: 1,
    actorId,
    expectedVersion: 3,
    requestedQuantity: 8,
    reason: body.reason,
    operationKey: operationKey(),
    status: SyncState.PENDING,
    sourceDocumentId: null,
    sourceVersion: null,
    resultQuantity: null,
    confirmedAt: null,
    createdAt: new Date('2026-11-26T07:00:00Z'),
    ...overrides,
  });

  const expected = {
    id: '10',
    variantId: '1',
    countedQuantity: 8,
    reason: body.reason,
    status: SyncState.PENDING,
    sourceReference: null,
    version: 3,
  };

  const tx = {
    inventoryAdjustment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    inventory: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    pendingInventoryEffect: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const prismaMock = {
    ...tx,
    inventoryAdjustment: {
      ...tx.inventoryAdjustment,
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const duplicateError = () =>
    new Prisma.PrismaClientKnownRequestError(
      'Duplicate operation key',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
      },
    );

  beforeEach(() => {
    jest.resetAllMocks();

    service = new InventoryAdjustmentService(
      prismaMock as unknown as PrismaService,
    );

    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    tx.inventoryAdjustment.findUnique.mockResolvedValue(null);

    tx.inventoryAdjustment.create.mockResolvedValue(
      makeAdjustment(),
    );

    tx.productVariant.findUnique.mockResolvedValue({
      id: 1,
      kiotvietVariantId: 'KV-SKU-001',
    });

    tx.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray) =>
        Promise.resolve(
          strings.join(' ').includes('product_variants')
            ? [{ id: 1 }]
            : [{ version: 3 }],
        ),
    );
  });

  afterEach(() => {
    const forbiddenWrites = [
      tx.inventoryAdjustment.update,
      tx.inventoryAdjustment.delete,
      tx.productVariant.update,
      tx.inventory.create,
      tx.inventory.update,
      tx.inventory.updateMany,
      tx.inventory.upsert,
      tx.inventory.delete,
      tx.inventoryMovement.create,
      tx.pendingInventoryEffect.create,
      tx.pendingInventoryEffect.updateMany,
      tx.$executeRaw,
    ];

    for (const mock of forbiddenWrites) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  // 1. CREATE ADJUSTMENT

  it('CREATE: accepts pending request without changing stock', async () => {
    expect(
      await service.create(actorId, key, body),
    ).toEqual(expected);

    expect(tx.inventoryAdjustment.create)
      .toHaveBeenCalledTimes(1);

    expect(tx.inventoryAdjustment.create)
      .toHaveBeenCalledWith({
        data: {
          operationKey: operationKey(),
          variantId: 1,
          actorId: 1,
          expectedVersion: 3,
          requestedQuantity: 8,
          reason: body.reason,
          status: SyncState.PENDING,
        },
      });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);

    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        expect.stringContaining('FROM product_variants'),
        expect.stringContaining('FOR UPDATE'),
      ]),
      1,
    );

    expect(tx.$queryRaw).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.stringContaining('FROM inventories'),
        expect.stringContaining('FOR UPDATE'),
      ]),
      1,
    );

    expect(prismaMock.$transaction)
      .toHaveBeenCalledWith(
        expect.any(Function),
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10000,
          timeout: 20000,
        },
      );
  });

  it.each([
    { countedQuantity: 0 },
    { countedQuantity: 2147483647 },
    { reason: 'x'.repeat(2000) },
    { reason: 'Valid reason with trailing space ' },
  ])('CREATE: accepts valid boundary input %j', async overrides => {
    const input = { ...body, ...overrides };

    await service.create(actorId, key, input);

    expect(tx.inventoryAdjustment.create)
      .toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestedQuantity: input.countedQuantity,
          reason: input.reason,
        }),
      });
  });

  it('CREATE: scopes idempotency key by actor', async () => {
    await service.create(2, key, body);

    expect(operationKey(2)).not.toBe(operationKey());

    expect(tx.inventoryAdjustment.create)
      .toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 2,
          operationKey: operationKey(2),
        }),
      });
  });

  it('CREATE: accepts minimum and maximum key length', async () => {
    for (const length of [16, 128]) {
      await service.create(actorId, 'k'.repeat(length), body);
    }

    expect(tx.inventoryAdjustment.create)
      .toHaveBeenCalledTimes(2);
  });

  // 2. IDEMPOTENCY

  it.each([
    SyncState.PENDING,
    SyncState.CONFIRMED,
    SyncState.NEEDS_RECONCILIATION,
  ])('REPLAY: returns existing request in state %s', async status => {
    tx.inventoryAdjustment.findUnique.mockResolvedValue(
      makeAdjustment({ status }),
    );

    expect(
      await service.create(actorId, key, body),
    ).toEqual({ ...expected, status });

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    { variantId: '2' },
    { version: 4 },
    { countedQuantity: 9 },
    { reason: 'Different reason' },
  ])('REPLAY: rejects changed payload %j', async overrides => {
    tx.inventoryAdjustment.findUnique.mockResolvedValue(
      makeAdjustment(),
    );

    await expect(
      service.create(actorId, key, {
        ...body,
        ...overrides,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'IDEMPOTENCY_KEY_REUSED',
      },
    });

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  it('REPLAY: rechecks operation after locking SKU', async () => {
    tx.inventoryAdjustment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeAdjustment());

    expect(
      await service.create(actorId, key, body),
    ).toEqual(expected);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  it('RACE: P2002 returns matching durable operation', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      duplicateError(),
    );

    prismaMock.inventoryAdjustment.findUnique.mockResolvedValue(
      makeAdjustment(),
    );

    expect(
      await service.create(actorId, key, body),
    ).toEqual(expected);

    expect(prismaMock.inventoryAdjustment.findUnique)
      .toHaveBeenCalledWith({
        where: {
          operationKey: operationKey(),
        },
      });
  });

  it('RACE: P2002 with different payload returns conflict', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      duplicateError(),
    );

    prismaMock.inventoryAdjustment.findUnique.mockResolvedValue(
      makeAdjustment({
        requestedQuantity: 99,
      }),
    );

    await expect(
      service.create(actorId, key, body),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'IDEMPOTENCY_KEY_REUSED',
      },
    });
  });

  it('ERROR: unrelated unique constraint error propagates', async () => {
    const error = duplicateError();

    prismaMock.$transaction.mockRejectedValueOnce(error);

    prismaMock.inventoryAdjustment.findUnique
      .mockResolvedValue(null);

    await expect(
      service.create(actorId, key, body),
    ).rejects.toBe(error);
  });

  it('ERROR: database failure is not hidden', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );

    await expect(
      service.create(actorId, key, body),
    ).rejects.toThrow('Database unavailable');
  });

  // 3. SKU AND INVENTORY VERSION

  it('SKU: missing variant returns 404', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      service.create(actorId, key, body),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  it('SKU: missing variant after lock returns 404', async () => {
    tx.productVariant.findUnique.mockResolvedValue(null);

    await expect(
      service.create(actorId, key, body),
    ).rejects.toMatchObject({ status: 404 });

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  it('SKU: missing KiotViet link returns 422', async () => {
    tx.productVariant.findUnique.mockResolvedValue({
      id: 1,
      kiotvietVariantId: null,
    });

    await expect(
      service.create(actorId, key, body),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'BUSINESS_RULE_VIOLATION',
      },
    });

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  it('STOCK: missing inventory returns 422', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([]);

    await expect(
      service.create(actorId, key, body),
    ).rejects.toMatchObject({ status: 422 });

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  it('VERSION: stale version returns 409', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ version: 4 }]);

    await expect(
      service.create(actorId, key, body),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'VERSION_CONFLICT',
      },
    });

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  // 4. REQUEST VALIDATION

  const invalidBodies: unknown[] = [
    null,
    [],
    {},
    { ...body, variantId: 1 },
    { ...body, variantId: '0' },
    { ...body, variantId: '01' },
    { ...body, variantId: '2147483648' },
    { ...body, version: '3' },
    { ...body, version: 0 },
    { ...body, version: 2147483648 },
    { ...body, countedQuantity: -1 },
    { ...body, countedQuantity: 1.5 },
    { ...body, countedQuantity: '8' },
    { ...body, countedQuantity: 2147483648 },
    { ...body, reason: '' },
    { ...body, reason: '   ' },
    { ...body, reason: 'x'.repeat(2001) },
    { ...body, actorId: 99 },
    { ...body, reason: 123 },
  ];

  it.each(
    invalidBodies.map(input => ({ input })),
  )('VALIDATION: rejects invalid body %#', async ({ input }) => {
    await expect(
      service.create(actorId, key, input),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: 'VALIDATION_ERROR',
      },
    });

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  it.each(
    [
      undefined,
      'short',
      'x'.repeat(129),
      ' ' + key,
      ['key1', 'key2'],
    ].map(token => ({ token })),
  )('VALIDATION: rejects invalid idempotency key %#', async ({ token }) => {
    await expect(
      service.create(actorId, token, body),
    ).rejects.toMatchObject({ status: 400 });

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])(
    'VALIDATION: rejects invalid actor %s',
    async actor => {
      await expect(
        service.create(actor, key, body),
      ).rejects.toMatchObject({ status: 400 });

      expect(prismaMock.$transaction)
        .not.toHaveBeenCalled();
    },
  );

  // 5. GET ADJUSTMENT

  it.each([
    SyncState.PENDING,
    SyncState.CONFIRMED,
    SyncState.NEEDS_RECONCILIATION,
  ])('GET: returns adjustment in state %s', async status => {
    prismaMock.inventoryAdjustment.findUnique.mockResolvedValue(
      makeAdjustment({
        status,
        sourceDocumentId: 'KV-ADJ-001',
      }),
    );

    expect(
      await service.findOne('10'),
    ).toEqual({
      ...expected,
      status,
      sourceReference: 'KV-ADJ-001',
    });

    expect(prismaMock.inventoryAdjustment.findUnique)
      .toHaveBeenCalledWith({
        where: { id: 10 },
      });
  });

  it('GET: missing adjustment returns 404', async () => {
    prismaMock.inventoryAdjustment.findUnique
      .mockResolvedValue(null);

    await expect(
      service.findOne('999999'),
    ).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'NOT_FOUND',
      },
    });
  });

  it.each([
    '',
    'abc',
    '0',
    '01',
    '2147483648',
  ])('GET: rejects invalid adjustmentId %s', async id => {
    await expect(
      service.findOne(id),
    ).rejects.toMatchObject({ status: 400 });

    expect(prismaMock.inventoryAdjustment.findUnique)
      .not.toHaveBeenCalled();
  });

  it('GET: database failure propagates', async () => {
    prismaMock.inventoryAdjustment.findUnique.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(
      service.findOne('10'),
    ).rejects.toThrow('Database unavailable');
  });
});
