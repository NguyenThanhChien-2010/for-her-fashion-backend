import { InventoryReason, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryMovementService } from './inventory-movement.service';

import type {
  InventoryMovementQuery,
} from './inventory-movement.service';

describe('BE-02 M03 InventoryMovementService', () => {
  const createdAt = new Date('2026-11-26T07:00:00.000Z');

  const tx = {
    productVariant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },

    inventoryMovement: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },

    inventory: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },

    pendingInventoryEffect: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },

    inventoryAdjustment: {
      create: jest.fn(),
    },

    $executeRaw: jest.fn(),
  };

  const prismaMock = {
    ...tx,
    $transaction: jest.fn(),
  };

  let service: InventoryMovementService;

  const makeMovement = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 10,
    variantId: 1,
    delta: -2,
    reason: InventoryReason.ORDER_CREATED,
    note: '  Web order 1001  ',
    sourceDocumentId: 'KV-ORDER-1001',
    createdAt,

    // Internal fields must not be exposed.
    operationKey: 'internal-operation-key',
    inventoryVersion: 2,
    createdBy: 1,
    refType: 'ORDER',
    refId: 1001,

    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    tx.productVariant.findUnique.mockResolvedValue({
      id: 1,
    });

    tx.inventoryMovement.count.mockResolvedValue(1);

    tx.inventoryMovement.findMany.mockResolvedValue([
      makeMovement(),
    ]);

    service = new InventoryMovementService(
      prismaMock as unknown as PrismaService,
    );
  });

  // 1. RESPONSE CONTRACT

  it('LIST: returns complete movement response and default pagination', async () => {
    const result = await service.findAll('1');

    expect(result).toEqual({
      items: [
        {
          id: '10',
          variantId: '1',
          delta: -2,
          reason: 'ORDER_CREATED: Web order 1001',
          sourceReference: 'KV-ORDER-1001',
          occurredAt: '2026-11-26T07:00:00.000Z',
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
      },
    });

    expect(tx.productVariant.findUnique)
      .toHaveBeenCalledWith({
        where: { id: 1 },
        select: { id: true },
      });

    expect(tx.inventoryMovement.count)
      .toHaveBeenCalledWith({
        where: { variantId: 1 },
      });

    expect(tx.inventoryMovement.findMany)
      .toHaveBeenCalledWith({
        where: { variantId: 1 },
        skip: 0,
        take: 20,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        select: {
          id: true,
          variantId: true,
          delta: true,
          reason: true,
          note: true,
          sourceDocumentId: true,
          createdAt: true,
        },
      });

    expect(prismaMock.$transaction)
      .toHaveBeenCalledTimes(1);

    expect(prismaMock.$transaction)
      .toHaveBeenCalledWith(
        expect.any(Function),
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );
  });

  // 2. PAGINATION

  it('LIST: uses stable descending order and correct pagination', async () => {
    tx.inventoryMovement.count.mockResolvedValue(5);

    tx.inventoryMovement.findMany.mockResolvedValue([
      makeMovement({
        id: 8,
        delta: 2,
        reason: InventoryReason.ORDER_CANCELLED,
      }),
      makeMovement({
        id: 7,
        delta: -2,
      }),
    ]);

    const result = await service.findAll('1', {
      page: '2',
      limit: '2',
    });

    expect(result.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 5,
    });

    expect(
      result.items.map(item => item.id),
    ).toEqual(['8', '7']);

    expect(tx.inventoryMovement.findMany)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: { variantId: 1 },
          skip: 2,
          take: 2,
          orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
        }),
      );
  });

  it('LIST: existing SKU without movements returns empty list', async () => {
    tx.inventoryMovement.count.mockResolvedValue(0);
    tx.inventoryMovement.findMany.mockResolvedValue([]);

    const result = await service.findAll('1');

    expect(result).toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });
  });

  // 3. MOVEMENT REASONS

  it.each([
    [InventoryReason.ORDER_CREATED, -2, null],
    [InventoryReason.ORDER_CANCELLED, 2, ''],
    [InventoryReason.PAYMENT_EXPIRED, 3, '   '],
    [InventoryReason.RETURN_RECEIVED, 1, null],
    [InventoryReason.ADMIN_ADJUST, -4, null],
  ])(
    'MOVEMENT: preserves reason %s and signed delta %s',
    async (reason, delta, note) => {
      tx.inventoryMovement.findMany.mockResolvedValue([
        makeMovement({
          reason,
          delta,
          note,
          sourceDocumentId: null,
        }),
      ]);

      const result = await service.findAll('1');

      expect(result.items[0]).toEqual({
        id: '10',
        variantId: '1',
        delta,
        reason,
        sourceReference: null,
        occurredAt: '2026-11-26T07:00:00.000Z',
      });
    },
  );

  // 4. MISSING SKU

  it('LIST: missing variant returns 404', async () => {
    tx.productVariant.findUnique.mockResolvedValue(null);

    await expect(
      service.findAll('999999'),
    ).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'NOT_FOUND',
      },
    });

    expect(tx.inventoryMovement.count)
      .not.toHaveBeenCalled();

    expect(tx.inventoryMovement.findMany)
      .not.toHaveBeenCalled();
  });

  // 5. READ-ONLY GUARANTEE

  it('LIST: repeated reads never mutate inventory or ledger', async () => {
    const first = await service.findAll('1');
    const second = await service.findAll('1');

    expect(first).toEqual(second);

    expect(prismaMock.$transaction)
      .toHaveBeenCalledTimes(2);

    const writeMocks = [
      tx.productVariant.update,
      tx.inventoryMovement.create,
      tx.inventoryMovement.update,
      tx.inventoryMovement.delete,
      tx.inventory.create,
      tx.inventory.update,
      tx.inventory.updateMany,
      tx.inventory.upsert,
      tx.inventory.delete,
      tx.pendingInventoryEffect.create,
      tx.pendingInventoryEffect.updateMany,
      tx.inventoryAdjustment.create,
      tx.$executeRaw,
    ];

    for (const mock of writeMocks) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  // 6. DATABASE ERROR

  it('ERROR: database failure is not hidden', async () => {
    tx.inventoryMovement.count.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(
      service.findAll('1'),
    ).rejects.toThrow('Database unavailable');
  });

  // 7. VARIANT ID VALIDATION

  it.each([
    '',
    'abc',
    '0',
    '-1',
    '01',
    '1.5',
    '2147483648',
    '9007199254740992',
  ])(
    'VALIDATION: rejects variantId "%s"',
    async (variantId) => {
      await expect(
        service.findAll(variantId),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'VALIDATION_ERROR',
        },
      });

      expect(prismaMock.$transaction)
        .not.toHaveBeenCalled();
    },
  );

  // 8. QUERY VALIDATION

  const invalidQueries: InventoryMovementQuery[] = [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '107374184' },
    { limit: '0' },
    { limit: '101' },
    { limit: '1e2' },
    {
      page: ['1', '2'],
    } as unknown as InventoryMovementQuery,
    {
      unsupported: 'true',
    } as unknown as InventoryMovementQuery,
  ];

  it.each(invalidQueries)(
    'VALIDATION: rejects query %j',
    async (query) => {
      await expect(
        service.findAll('1', query),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'VALIDATION_ERROR',
        },
      });

      expect(prismaMock.$transaction)
        .not.toHaveBeenCalled();

      expect(tx.inventoryMovement.findMany)
        .not.toHaveBeenCalled();
    },
  );
});
