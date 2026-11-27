import {
  ProductStatus,
  SyncState,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';

describe('BE-02 M03 InventoryService', () => {
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
      findMany: jest.fn(),
    },

    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };

  let service: InventoryService;

  const makeInventory = (
    overrides: Record<string, unknown> = {},
  ) => ({
    quantity: 10,
    syncStatus: SyncState.PENDING,
    lastConfirmedAt: null,
    ...overrides,
  });

  const makeVariant = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 1,
    sku: 'BE02-TEST-P3-RED-M',
    inventory: makeInventory(),
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.productVariant.findFirst
      .mockResolvedValue(makeVariant());

    service = new InventoryService(
      prismaMock as unknown as PrismaService,
    );
  });

  it('AVAILABILITY: returns current sellable quantity', async () => {
    const result =
      await service.getPublicAvailability('1');

    expect(result).toEqual({
      variantId: '1',
      sku: 'BE02-TEST-P3-RED-M',
      availableQuantity: 10,
      syncStatus: SyncState.PENDING,
      lastConfirmedAt: null,
    });
  });

  it('AVAILABILITY: out of stock returns zero', async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(
      makeVariant({
        inventory: makeInventory({
          quantity: 0,
        }),
      }),
    );

    const result =
      await service.getPublicAvailability('1');

    expect(result.availableQuantity).toBe(0);
  });

  it('AVAILABILITY: missing inventory returns zero and pending', async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(
      makeVariant({
        inventory: null,
      }),
    );

    const result =
      await service.getPublicAvailability('1');

    expect(result).toEqual({
      variantId: '1',
      sku: 'BE02-TEST-P3-RED-M',
      availableQuantity: 0,
      syncStatus: SyncState.PENDING,
      lastConfirmedAt: null,
    });
  });

  it('AVAILABILITY: negative quantity is not exposed', async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(
      makeVariant({
        inventory: makeInventory({
          quantity: -3,
          syncStatus: SyncState.NEEDS_RECONCILIATION,
        }),
      }),
    );

    const result =
      await service.getPublicAvailability('1');

    expect(result.availableQuantity).toBe(0);

    expect(result.syncStatus).toBe(
      SyncState.NEEDS_RECONCILIATION,
    );
  });

  it.each([
    SyncState.CONFIRMED,
    SyncState.PENDING,
    SyncState.NEEDS_RECONCILIATION,
  ])(
    'AVAILABILITY: preserves sync state %s',
    async (syncStatus) => {
      prismaMock.productVariant.findFirst.mockResolvedValue(
        makeVariant({
          inventory: makeInventory({
            syncStatus,
          }),
        }),
      );

      const result =
        await service.getPublicAvailability('1');

      expect(result.syncStatus).toBe(syncStatus);
    },
  );

  it('AVAILABILITY: converts confirmed date to ISO string', async () => {
    const confirmedAt =
      new Date('2026-11-26T07:00:00.000Z');

    prismaMock.productVariant.findFirst.mockResolvedValue(
      makeVariant({
        inventory: makeInventory({
          syncStatus: SyncState.CONFIRMED,
          lastConfirmedAt: confirmedAt,
        }),
      }),
    );

    const result =
      await service.getPublicAvailability('1');

    expect(result.lastConfirmedAt).toBe(
      '2026-11-26T07:00:00.000Z',
    );
  });

  it('AVAILABILITY: missing or non-public variant returns 404', async () => {
    prismaMock.productVariant.findFirst
      .mockResolvedValue(null);

    await expect(
      service.getPublicAvailability('999999'),
    ).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'NOT_FOUND',
      },
    });
  });

  it('AVAILABILITY: only active variants of active products', async () => {
    await service.getPublicAvailability('1');

    expect(
      prismaMock.productVariant.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        id: 1,
        isActive: true,
        product: {
          is: {
            status: ProductStatus.ACTIVE,
          },
        },
      },
      select: {
        id: true,
        sku: true,
        inventory: {
          select: {
            quantity: true,
            syncStatus: true,
            lastConfirmedAt: true,
          },
        },
      },
    });
  });

  it.each([
    '',
    'abc',
    '0',
    '-1',
    '1.5',
    '01',
    ' 1',
    '1 ',
    '1e2',
    '1 OR 1=1',
  ])(
    'AVAILABILITY: invalid variantId "%s" returns 400',
    async (variantId) => {
      await expect(
        service.getPublicAvailability(variantId),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'VALIDATION_ERROR',
        },
      });

      expect(
        prismaMock.productVariant.findFirst,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    '2147483648',
    '9007199254740992',
    '999999999999999999999',
  ])(
    'AVAILABILITY: overflowing ID "%s" returns 400',
    async (variantId) => {
      await expect(
        service.getPublicAvailability(variantId),
      ).rejects.toMatchObject({
        status: 400,
      });

      expect(
        prismaMock.productVariant.findFirst,
      ).not.toHaveBeenCalled();
    },
  );

  it('AVAILABILITY: accepts maximum MySQL signed INT ID', async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(
      makeVariant({
        id: 2147483647,
      }),
    );

    const result =
      await service.getPublicAvailability('2147483647');

    expect(result.variantId).toBe('2147483647');

    expect(
      prismaMock.productVariant.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 2147483647,
        }),
      }),
    );
  });

  it('AVAILABILITY: does not expose internal inventory data', async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(
      makeVariant({
        inventory: makeInventory({
          sourceQuantity: 15,
          sourceVersion: 'KV-TEST-V1',
          pendingDelta: -5,
          version: 3,
        }),
      }),
    );

    const result =
      await service.getPublicAvailability('1');

    expect(Object.keys(result).sort()).toEqual(
      [
        'variantId',
        'sku',
        'availableQuantity',
        'syncStatus',
        'lastConfirmedAt',
      ].sort(),
    );

    expect(result).not.toHaveProperty('sourceQuantity');
    expect(result).not.toHaveProperty('sourceVersion');
    expect(result).not.toHaveProperty('pendingDelta');
    expect(result).not.toHaveProperty('version');
  });

  it('AVAILABILITY: does not deduct pending effects twice', async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(
      makeVariant({
        inventory: makeInventory({
          quantity: 8,
          sourceQuantity: 10,
          pendingDelta: -2,
        }),
      }),
    );

    const result =
      await service.getPublicAvailability('1');

    expect(result.availableQuantity).toBe(8);

    expect(
      prismaMock.pendingInventoryEffect.aggregate,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.pendingInventoryEffect.findMany,
    ).not.toHaveBeenCalled();
  });

  it('AVAILABILITY: repeated reads never mutate inventory', async () => {
    const first =
      await service.getPublicAvailability('1');

    const second =
      await service.getPublicAvailability('1');

    const third =
      await service.getPublicAvailability('1');

    expect(first).toEqual(second);
    expect(second).toEqual(third);

    expect(
      prismaMock.productVariant.findFirst,
    ).toHaveBeenCalledTimes(3);

    expect(
      prismaMock.productVariant.update,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.productVariant.updateMany,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.inventory.create,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.inventory.update,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.inventory.updateMany,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.inventory.upsert,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.inventory.delete,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.inventoryMovement.create,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.pendingInventoryEffect.create,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.$transaction,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.$executeRaw,
    ).not.toHaveBeenCalled();
  });

  it('AVAILABILITY: database errors are not hidden', async () => {
    prismaMock.productVariant.findFirst.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(
      service.getPublicAvailability('1'),
    ).rejects.toThrow('Database unavailable');
  });
});
