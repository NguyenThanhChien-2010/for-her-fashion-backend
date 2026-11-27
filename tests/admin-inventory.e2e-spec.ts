import { INestApplication } from '@nestjs/common';



import { Prisma, SyncState } from '@prisma/client';


import request from 'supertest';
import type { App } from 'supertest/types';
import { createInventoryTestApp, expectNoInventoryWrites, expectSafeInventoryError, TestAuthGuard } from './helpers/inventory-e2e.helper';




const confirmedAt =
  new Date('2026-11-26T07:00:00.000Z');

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

const tx = {
  productVariant: {
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },

  pendingInventoryEffect: {
    groupBy: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
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

const loggerMock = {
  error: jest.fn(),
};

describe('BE-02 M03 Admin Inventory HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = '/api/v1/admin/inventory';

  const getAs = (
    token: string,
    query: Record<string, string> = {},
  ) =>
    request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', `Bearer ${token}`)
      .query(query);

  beforeAll(async () => {
    app = await createInventoryTestApp(prismaMock, loggerMock, TestAuthGuard);
  });

  afterAll(async () => {
    await app?.close();
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
  });

  // ==========================================
  // 1. AUTHENTICATION AND AUTHORIZATION
  // ==========================================

  it.each([
    'test-admin',
    'test-staff',
  ])(
    'AUTH: %s can access inventory - 200',
    async (token) => {
      const res = await getAs(token)
        .set('X-Request-ID', 'm03-admin-inventory')
        .expect(200);

      expect(res.body).toEqual({
        data: {
          items: [
            {
              variantId: '1',
              sku: 'M03-RED-M',
              availableQuantity: 8,
              sourceQuantity: 10,
              pendingDelta: -2,
              syncStatus: 'PENDING',
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
        },
        traceId: 'm03-admin-inventory',
      });

      expect(res.headers['x-request-id']).toBe(
        'm03-admin-inventory',
      );

      expect(prismaMock.$transaction)
        .toHaveBeenCalledWith(
          expect.any(Function),
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.RepeatableRead,
          },
        );
    },
  );

  it('AUTH: CUSTOMER is forbidden - 403', async () => {
    const res = await getAs('test-customer')
      .expect(403);

    expect(res.body).toMatchObject({
      error: {
        code: 'FORBIDDEN',
      },
      traceId: expect.any(String),
    });

    expect(res.body).not.toHaveProperty('data');

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  it('AUTH: missing authentication - 401', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .expect(401);

    expect(res.body).toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
      traceId: expect.any(String),
    });

    expect(res.body).not.toHaveProperty('data');

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  it('AUTH: invalid authentication credential - 401', async () => {
    const res = await getAs('invalid-test-token')
      .expect(401);

    expect(res.body).toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
    });

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  // ==========================================
  // 2. SEARCH AND FILTERS
  // ==========================================

  it('LIST: searches SKU, product name and baseCode', async () => {
    await getAs('test-admin', {
      q: '  M03  ',
    }).expect(200);

    expect(tx.productVariant.count)
      .toHaveBeenCalledWith({
        where: {
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
        },
      });
  });

  it('LIST: filters by variantId', async () => {
    await getAs('test-admin', {
      variantId: '1',
    }).expect(200);

    expect(tx.productVariant.count)
      .toHaveBeenCalledWith({
        where: {
          id: 1,
        },
      });
  });

  it('LIST: combines keyword and variantId', async () => {
    await getAs('test-staff', {
      variantId: '1',
      q: 'M03',
    }).expect(200);

    expect(tx.productVariant.count)
      .toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 1,
          OR: expect.any(Array),
        }),
      });
  });

  // ==========================================
  // 3. PAGINATION
  // ==========================================

  it('LIST: returns correct pagination and ID order', async () => {
    tx.productVariant.count.mockResolvedValue(5);

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

    tx.pendingInventoryEffect.groupBy
      .mockResolvedValue([]);

    const res = await getAs('test-admin', {
      page: '2',
      limit: '2',
    }).expect(200);

    expect(res.body.data.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 5,
    });

    expect(res.body.data.items).toEqual([
      expect.objectContaining({
        variantId: '3',
      }),
      expect.objectContaining({
        variantId: '4',
      }),
    ]);

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

  it('LIST: no matching SKU returns empty items', async () => {
    tx.productVariant.count.mockResolvedValue(0);

    tx.productVariant.findMany
      .mockResolvedValue([]);

    const res = await getAs('test-admin', {
      q: 'NO-MATCH',
    }).expect(200);

    expect(res.body.data).toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });

    expect(tx.pendingInventoryEffect.groupBy)
      .not.toHaveBeenCalled();
  });

  // ==========================================
  // 4. INVENTORY RESPONSE
  // ==========================================

  it('STOCK: missing inventory returns initial values', async () => {
    tx.productVariant.findMany.mockResolvedValue([
      makeVariant({
        inventory: null,
      }),
    ]);

    tx.pendingInventoryEffect.groupBy
      .mockResolvedValue([]);

    const res = await getAs('test-admin')
      .expect(200);

    expect(res.body.data.items).toEqual([
      {
        variantId: '1',
        sku: 'M03-RED-M',
        availableQuantity: 0,
        sourceQuantity: null,
        pendingDelta: 0,
        syncStatus: 'PENDING',
        lastConfirmedAt: null,
        version: 1,
      },
    ]);

    expect(tx.inventory.create)
      .not.toHaveBeenCalled();

    expect(tx.inventory.upsert)
      .not.toHaveBeenCalled();
  });

  it('STOCK: pending effects are aggregated per SKU without double deduction', async () => {
    tx.productVariant.count.mockResolvedValue(2);

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

    const res = await getAs('test-admin')
      .expect(200);

    expect(res.body.data.items).toEqual([
      expect.objectContaining({
        variantId: '1',
        availableQuantity: 8,
        sourceQuantity: 10,
        pendingDelta: -2,
      }),
      expect.objectContaining({
        variantId: '2',
        availableQuantity: 12,
        sourceQuantity: 10,
        pendingDelta: 2,
      }),
    ]);

    expect(tx.pendingInventoryEffect.groupBy)
      .toHaveBeenCalledTimes(1);

    expect(tx.pendingInventoryEffect.groupBy)
      .toHaveBeenCalledWith({
        by: ['variantId'],
        where: {
          variantId: {
            in: [1, 2],
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
  // 5. VALIDATION
  // ==========================================

  it.each([
    'variantId=0',
    'variantId=abc',
    'variantId=2147483648',
    'page=0',
    'limit=101',
    'limit=1e2',
    'unsupported=true',
    'page=1&page=2',
  ])(
    'VALIDATION: rejects %s - 400',
    async (queryString) => {
      const res = await request(app.getHttpServer())
        .get(`${endpoint}?${queryString}`)
        .set('Authorization', 'Bearer test-admin')
        .expect(400);

      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.any(String),
          details: expect.any(Array),
        },
        traceId: expect.any(String),
      });

      expect(prismaMock.$transaction)
        .not.toHaveBeenCalled();
    },
  );

  // ==========================================
  // 6. READ-ONLY GUARANTEE
  // ==========================================

  it('STOCK: repeated requests never mutate inventory', async () => {
    const first = await getAs('test-admin')
      .expect(200);

    const second = await getAs('test-staff')
      .expect(200);

    expect(first.body.data)
      .toEqual(second.body.data);

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
      tx.inventoryMovement.create,
      tx.inventoryAdjustment.create,
      tx.$executeRaw,
    ];

    expectNoInventoryWrites(writeMocks);
  });

  // ==========================================
  // 7. ERROR HANDLING
  // ==========================================

  it('ERROR: database failure returns safe response - 500', async () => {
    tx.productVariant.count.mockRejectedValueOnce(
      new Error('Internal inventory database error'),
    );

    const res = await getAs('test-admin')
      .expect(500);

    expectSafeInventoryError(res, 'Internal inventory database error', loggerMock);
  });
});
