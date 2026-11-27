import { INestApplication } from '@nestjs/common';



import {
  ProductStatus,
  SyncState,
} from '@prisma/client';


import request from 'supertest';
import type { App } from 'supertest/types';
import { createInventoryTestApp, expectNoInventoryWrites } from './helpers/inventory-e2e.helper';


import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';


interface TestInventory {
  quantity: number;
  syncStatus: SyncState;
  lastConfirmedAt: Date | null;
  sourceQuantity?: number;
  sourceVersion?: string;
  pendingDelta?: number;
  version?: number;
}

interface TestVariant {
  id: number;
  sku: string;
  isActive: boolean;
  productStatus: ProductStatus;
  inventory: TestInventory | null;
}

interface VariantWhere {
  id: number;
  isActive: boolean;
  product: {
    is: {
      status: ProductStatus;
    };
  };
}

const confirmedAt =
  new Date('2026-11-26T07:00:00.000Z');

const variants: TestVariant[] = [
  {
    id: 1,
    sku: 'M03-RED-M',
    isActive: true,
    productStatus: ProductStatus.ACTIVE,
    inventory: {
      quantity: 8,
      syncStatus: SyncState.CONFIRMED,
      lastConfirmedAt: confirmedAt,
      sourceQuantity: 10,
      sourceVersion: 'KV-TEST-V1',
      pendingDelta: -2,
      version: 3,
    },
  },
  {
    id: 2,
    sku: 'M03-RED-L',
    isActive: true,
    productStatus: ProductStatus.ACTIVE,
    inventory: {
      quantity: 0,
      syncStatus: SyncState.PENDING,
      lastConfirmedAt: null,
    },
  },
  {
    id: 3,
    sku: 'M03-NO-INVENTORY',
    isActive: true,
    productStatus: ProductStatus.ACTIVE,
    inventory: null,
  },
  {
    id: 4,
    sku: 'M03-INACTIVE',
    isActive: false,
    productStatus: ProductStatus.ACTIVE,
    inventory: {
      quantity: 10,
      syncStatus: SyncState.CONFIRMED,
      lastConfirmedAt: confirmedAt,
    },
  },
  {
    id: 5,
    sku: 'M03-HIDDEN',
    isActive: true,
    productStatus: ProductStatus.HIDDEN,
    inventory: null,
  },
  {
    id: 6,
    sku: 'M03-DISCONTINUED',
    isActive: true,
    productStatus: ProductStatus.DISCONTINUED,
    inventory: null,
  },
  {
    id: 7,
    sku: 'M03-RECONCILIATION',
    isActive: true,
    productStatus: ProductStatus.ACTIVE,
    inventory: {
      quantity: 3,
      syncStatus: SyncState.NEEDS_RECONCILIATION,
      lastConfirmedAt: null,
    },
  },
];

const prismaMock = {
  productVariant: {
    findFirst: jest.fn(),
    update: jest.fn(),
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

  pendingInventoryEffect: {
    create: jest.fn(),
    aggregate: jest.fn(),
  },

  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
};

const loggerMock = {
  error: jest.fn(),
};

describe('BE-02 M03 Public Inventory HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = (variantId: string) =>
    `/api/v1/variants/${variantId}/availability`;

  beforeAll(async () => {
    app = await createInventoryTestApp(prismaMock, loggerMock, JwtAuthGuard);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.productVariant.findFirst
      .mockImplementation(
        ({ where }: { where: VariantWhere }) => {
          const row = variants.find(
            (variant) =>
              variant.id === where.id &&
              variant.isActive === where.isActive &&
              variant.productStatus ===
                where.product.is.status,
          );

          return Promise.resolve(row ?? null);
        },
      );
  });

  it('PUBLIC: returns availability without JWT - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint('1'))
      .set('X-Request-ID', 'm03-availability-test')
      .expect(200);

    expect(res.body).toEqual({
      data: {
        variantId: '1',
        sku: 'M03-RED-M',
        availableQuantity: 8,
        syncStatus: 'CONFIRMED',
        lastConfirmedAt:
          '2026-11-26T07:00:00.000Z',
      },
      traceId: 'm03-availability-test',
    });

    expect(res.headers['x-request-id']).toBe(
      'm03-availability-test',
    );

    expect(
      prismaMock.pendingInventoryEffect.aggregate,
    ).not.toHaveBeenCalled();
  });

  it('PUBLIC: out of stock returns zero - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint('2'))
      .expect(200);

    expect(res.body).toMatchObject({
      data: {
        variantId: '2',
        availableQuantity: 0,
        syncStatus: 'PENDING',
      },
      traceId: expect.any(String),
    });
  });

  it('PUBLIC: missing inventory returns zero and pending - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint('3'))
      .expect(200);

    expect(res.body).toMatchObject({
      data: {
        variantId: '3',
        availableQuantity: 0,
        syncStatus: 'PENDING',
        lastConfirmedAt: null,
      },
    });

    expect(
      prismaMock.inventory.create,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.inventory.upsert,
    ).not.toHaveBeenCalled();
  });

  it('PUBLIC: preserves reconciliation state - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint('7'))
      .expect(200);

    expect(res.body).toMatchObject({
      data: {
        variantId: '7',
        availableQuantity: 3,
        syncStatus: 'NEEDS_RECONCILIATION',
      },
    });
  });

  it.each([
    ['4', 'inactive variant'],
    ['5', 'hidden product'],
    ['6', 'discontinued product'],
    ['999999', 'missing variant'],
  ])(
    'PUBLIC: variant %s (%s) returns 404',
    async (variantId) => {
      const res = await request(app.getHttpServer())
        .get(endpoint(variantId))
        .expect(404);

      expect(res.body).toMatchObject({
        error: {
          code: 'NOT_FOUND',
          message: expect.any(String),
        },
        traceId: expect.any(String),
      });
    },
  );

  it.each([
    'abc',
    '0',
    '-1',
    '01',
    '1.5',
    '2147483648',
  ])(
    'PUBLIC: invalid variantId %s returns 400',
    async (variantId) => {
      const res = await request(app.getHttpServer())
        .get(endpoint(variantId))
        .expect(400);

      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.any(String),
        },
        traceId: expect.any(String),
      });

      expect(
        prismaMock.productVariant.findFirst,
      ).not.toHaveBeenCalled();
    },
  );

  it('PUBLIC: repeated requests do not mutate stock', async () => {
    const first = await request(app.getHttpServer())
      .get(endpoint('1'))
      .set('X-Request-ID', 'm03-read-only')
      .expect(200);

    const second = await request(app.getHttpServer())
      .get(endpoint('1'))
      .set('X-Request-ID', 'm03-read-only')
      .expect(200);

    expect(first.body).toEqual(second.body);

    expect(
      prismaMock.productVariant.findFirst,
    ).toHaveBeenCalledTimes(2);

    const writeMocks = [
      prismaMock.productVariant.update,
      prismaMock.productVariant.updateMany,
      prismaMock.inventory.create,
      prismaMock.inventory.update,
      prismaMock.inventory.updateMany,
      prismaMock.inventory.upsert,
      prismaMock.inventory.delete,
      prismaMock.inventoryMovement.create,
      prismaMock.pendingInventoryEffect.create,
      prismaMock.$transaction,
      prismaMock.$executeRaw,
    ];

    expectNoInventoryWrites(writeMocks);
  });

  it('PUBLIC: database failure returns safe error - 500', async () => {
    prismaMock.productVariant.findFirst
      .mockRejectedValueOnce(
        new Error('Internal database test failure'),
      );

    const res = await request(app.getHttpServer())
      .get(endpoint('1'))
      .expect(500);

    expect(res.body).toMatchObject({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: expect.any(String),
      },
      traceId: expect.any(String),
    });

    expect(JSON.stringify(res.body)).not.toContain(
      'Internal database test failure',
    );

    expect(loggerMock.error).toHaveBeenCalled();
  });
});
