import { Prisma, SyncState } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AdminInventoryService } from './admin-inventory.service';

import type {
  AdminInventoryQuery,
} from './admin-inventory.service';

describe('BE-02 M03 AdminInventoryService', () => {
  const confirmedAt =
    new Date('2026-11-26T07:00:00.000Z');

  const tx = {
    productVariant: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    pendingInventoryEffect: {
      groupBy: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
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
    inventoryAdjustment: {
      create: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };

  const prismaMock = {
    ...tx,
    $transaction: jest.fn(),
  };

  let service: AdminInventoryService;

  const makeInventory = (
    overrides: Record<string, unknown> = {},
  ) => ({
    quantity: 8,
    sourceQuantity: 10,
    syncStatus: SyncState.PENDING,
    lastConfirmedAt: confirmedAt,
    version: 3,
    ...overrides,
  });

  const makeVariant = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 1,
    sku: 'M03-RED-M',
    inventory: makeInventory(),
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    tx.productVariant.count.mockResolvedValue(1);

    tx.productVariant.findMany.mockResolvedValue([
      makeVariant(),
    ]);

    tx.pendingInventoryEffect.groupBy.mockResolvedValue([
      {
        variantId: 1,
        _sum: {
          delta: -2,
        },
      },
    ]);

    service = new AdminInventoryService(
      prismaMock as unknown as PrismaService,
    );
  });

  // ==========================================
  // 1. DEFAULT LIST AND RESPONSE CONTRACT
  // ==========================================

  it('LIST: default pagination and complete inventory response', async () => {
    const result = await service.findAll();

    expect(result).toEqual({
      items: [
        {
          variantId: '1',
          sku: 'M03-RED-M',
          availableQuantity: 8,
          sourceQuantity: 10,
          pendingDelta: -2,
          syncStatus: SyncState.PENDING,
          lastConfirmedAt:
            '2026-11-26T07:00:00.000Z',
          version: 3,
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
      },
    });

    expect(tx.productVariant.count)
      .toHaveBeenCalledWith({
        where: {},
      });

    expect(tx.productVariant.findMany)
      .toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: {
          id: 'asc',
        },
        select: {
          id: true,
          sku: true,
          inventory: {
            select: {
              quantity: true,
              sourceQuantity: true,
              syncStatus: true,
              lastConfirmedAt: true,
              version: true,
            },
          },
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

  // ==========================================
  // 2. SEARCH AND FILTERS
  // ==========================================

  it('LIST: combines variantId and trimmed keyword', async () => {
    await service.findAll({
      variantId: '1',
      q: '  M03  ',
    });

    const where = {
      id: 1,
      OR: [
        {
          sku: {
            contains: 'M03',
          },
        },
        {
          product: {
            is: {
              name: {
                contains: 'M03',
              },
            },
          },
        },
        {
          product: {
            is: {
              baseCode: {
                contains: 'M03',
              },
            },
          },
        },
      ],
    };

    expect(tx.productVariant.count)
      .toHaveBeenCalledWith({
        where,
      });

    expect(tx.productVariant.findMany)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where,
        }),
      );
  });

  it('LIST: blank keyword does not add search conditions', async () => {
    await service.findAll({
      q: '   ',
    });

    expect(tx.productVariant.count)
      .toHaveBeenCalledWith({
        where: {},
      });
  });

  // ==========================================
  // 3. PAGINATION
  // ==========================================

  it('LIST: pagination uses stable ID order', async () => {
    tx.productVariant.count.mockResolvedValue(10);

    tx.productVariant.findMany.mockResolvedValue([
      makeVariant({
        id: 3,
        sku: 'M03-BLUE-M',
      }),
      makeVariant({
        id: 4,
        sku: 'M03-BLUE-L',
      }),
    ]);

    const result = await service.findAll({
      page: '2',
      limit: '2',
    });

    expect(result.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 10,
    });

    expect(
      result.items.map((item) => item.variantId),
    ).toEqual(['3', '4']);

    expect(tx.productVariant.findMany)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 2,
          take: 2,
          orderBy: {
            id: 'asc',
          },
        }),
      );
  });

  it('LIST: empty page skips pending effect aggregation', async () => {
    tx.productVariant.count.mockResolvedValue(10);

    tx.productVariant.findMany.mockResolvedValue([]);

    const result = await service.findAll({
      page: '10',
      limit: '2',
    });

    expect(result).toEqual({
      items: [],
      pagination: {
        page: 10,
        limit: 2,
        total: 10,
      },
    });

    expect(tx.pendingInventoryEffect.groupBy)
      .not.toHaveBeenCalled();
  });

  // ==========================================
  // 4. PENDING INVENTORY EFFECTS
  // ==========================================

  it('STOCK: aggregates unresolved effects per SKU', async () => {
    tx.productVariant.count.mockResolvedValue(3);

    tx.productVariant.findMany.mockResolvedValue([
      makeVariant(),
      makeVariant({
        id: 2,
        sku: 'M03-RED-L',
        inventory: makeInventory({
          quantity: 12,
          sourceQuantity: 10,
        }),
      }),
      makeVariant({
        id: 3,
        sku: 'M03-BLUE-M',
      }),
    ]);

    tx.pendingInventoryEffect.groupBy.mockResolvedValue([
      {
        variantId: 1,
        _sum: {
          delta: -2,
        },
      },
      {
        variantId: 2,
        _sum: {
          delta: 2,
        },
      },
    ]);

    const result = await service.findAll();

    expect(
      result.items.map((item) => ({
        id: item.variantId,
        quantity: item.availableQuantity,
        pendingDelta: item.pendingDelta,
      })),
    ).toEqual([
      {
        id: '1',
        quantity: 8,
        pendingDelta: -2,
      },
      {
        id: '2',
        quantity: 12,
        pendingDelta: 2,
      },
      {
        id: '3',
        quantity: 8,
        pendingDelta: 0,
      },
    ]);

    expect(tx.pendingInventoryEffect.groupBy)
      .toHaveBeenCalledTimes(1);

    expect(tx.pendingInventoryEffect.groupBy)
      .toHaveBeenCalledWith({
        by: ['variantId'],
        where: {
          variantId: {
            in: [1, 2, 3],
          },
          status: {
            in: [
              SyncState.PENDING,
              SyncState.NEEDS_RECONCILIATION,
            ],
          },
          releasedAt: null,
        },
        _sum: {
          delta: true,
        },
      });
  });

  // ==========================================
  // 5. MISSING INVENTORY AND SYNC STATUS
  // ==========================================

  it('STOCK: missing inventory returns initial values', async () => {
    tx.productVariant.findMany.mockResolvedValue([
      makeVariant({
        inventory: null,
      }),
    ]);

    tx.pendingInventoryEffect.groupBy
      .mockResolvedValue([]);

    const result = await service.findAll();

    expect(result.items[0]).toEqual({
      variantId: '1',
      sku: 'M03-RED-M',
      availableQuantity: 0,
      sourceQuantity: null,
      pendingDelta: 0,
      syncStatus: SyncState.PENDING,
      lastConfirmedAt: null,
      version: 1,
    });

    expect(tx.inventory.create)
      .not.toHaveBeenCalled();

    expect(tx.inventory.upsert)
      .not.toHaveBeenCalled();
  });

  it('STOCK: negative sellable quantity is clamped to zero', async () => {
    tx.productVariant.findMany.mockResolvedValue([
      makeVariant({
        inventory: makeInventory({
          quantity: -5,
        }),
      }),
    ]);

    const result = await service.findAll();

    expect(result.items[0].availableQuantity)
      .toBe(0);
  });

  it.each([
    SyncState.PENDING,
    SyncState.CONFIRMED,
    SyncState.NEEDS_RECONCILIATION,
  ])(
    'STOCK: preserves sync status %s',
    async (syncStatus) => {
      tx.productVariant.findMany.mockResolvedValue([
        makeVariant({
          inventory: makeInventory({
            syncStatus,
          }),
        }),
      ]);

      const result = await service.findAll();

      expect(result.items[0].syncStatus)
        .toBe(syncStatus);
    },
  );

  // ==========================================
  // 6. READ-ONLY GUARANTEE
  // ==========================================

  it('STOCK: repeated reads never mutate inventory', async () => {
    const first = await service.findAll();
    const second = await service.findAll();

    expect(first).toEqual(second);

    expect(prismaMock.$transaction)
      .toHaveBeenCalledTimes(2);

    const writeMocks = [
      tx.productVariant.update,
      tx.inventory.create,
      tx.inventory.update,
      tx.inventory.updateMany,
      tx.inventory.upsert,
      tx.inventory.delete,
      tx.pendingInventoryEffect.create,
      tx.pendingInventoryEffect.updateMany,
      tx.pendingInventoryEffect.deleteMany,
      tx.inventoryMovement.create,
      tx.inventoryAdjustment.create,
      tx.$executeRaw,
    ];

    for (const mock of writeMocks) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  // ==========================================
  // 7. ERROR HANDLING
  // ==========================================

  it('ERROR: invalid source quantity returns 500', async () => {
    tx.productVariant.findMany.mockResolvedValue([
      makeVariant({
        inventory: makeInventory({
          sourceQuantity: -1,
        }),
      }),
    ]);

    await expect(
      service.findAll(),
    ).rejects.toMatchObject({
      status: 500,
      response: {
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
  });

  it('ERROR: unsafe pending delta returns 500', async () => {
    tx.pendingInventoryEffect.groupBy.mockResolvedValue([
      {
        variantId: 1,
        _sum: {
          delta: Number.MAX_SAFE_INTEGER + 1,
        },
      },
    ]);

    await expect(
      service.findAll(),
    ).rejects.toMatchObject({
      status: 500,
      response: {
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
  });

  it('ERROR: database failure is not hidden', async () => {
    tx.productVariant.count.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(
      service.findAll(),
    ).rejects.toThrow(
      'Database unavailable',
    );
  });

  // ==========================================
  // 8. INPUT VALIDATION
  // ==========================================

  it('VALIDATION: accepts maximum limit and variantId', async () => {
    await service.findAll({
      variantId: '2147483647',
      limit: '100',
    });

    expect(tx.productVariant.findMany)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 2147483647,
          },
          take: 100,
        }),
      );
  });

  const invalidQueries: AdminInventoryQuery[] = [
    { variantId: '0' },
    { variantId: '-1' },
    { variantId: '01' },
    { variantId: 'abc' },
    { variantId: '2147483648' },
    { page: '0' },
    { page: '1.5' },
    { page: '107374184' },
    { limit: '0' },
    { limit: '101' },
    { limit: '1e2' },
    { q: 'x'.repeat(256) },
    {
      q: ['M03', 'SKU'],
    } as unknown as AdminInventoryQuery,
    {
      q: { name: 'M03' },
    } as unknown as AdminInventoryQuery,
    {
      page: ['1', '2'],
    } as unknown as AdminInventoryQuery,
    {
      unsupported: 'true',
    } as unknown as AdminInventoryQuery,
  ];

  it.each(invalidQueries)(
    'VALIDATION: rejects invalid query %j',
    async (query) => {
      await expect(
        service.findAll(query),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'VALIDATION_ERROR',
        },
      });

      expect(prismaMock.$transaction)
        .not.toHaveBeenCalled();

      expect(tx.productVariant.count)
        .not.toHaveBeenCalled();

      expect(tx.productVariant.findMany)
        .not.toHaveBeenCalled();
    },
  );
});
