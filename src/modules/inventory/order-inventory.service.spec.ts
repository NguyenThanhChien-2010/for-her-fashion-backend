import {
  InventoryReason,
  Prisma,
  SyncState,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { OrderInventoryService } from './order-inventory.service';

describe('OrderInventoryService - releaseForOrder', () => {
  const orderId = 100;
  const variantId = 5;

  const deductKey = 'M03-ORDER-100-SKU-5-DEDUCT';
  const releaseKey = 'M03-ORDER-100-SKU-5-RELEASE';

  function setup() {
    const stock = {
      quantity: 7,
      version: 2,
      syncStatus: SyncState.PENDING as SyncState,
    };

    const order = {
      status: 'CANCELLED',
      deliveryStatus: 'NOT_SHIPPED',
      paymentMethod: 'MOMO',
      paymentStatus: 'UNPAID',
      paymentExpiresAt: new Date(Date.now() - 60000),
      paymentSummary: {
        status: 'UNPAID',
        paidAmount: new Prisma.Decimal(0),
      },
      items: [{ variantId, quantity: 3 }],
    };

    const originalMovement = {
      id: 1,
      operationKey: deductKey,
      variantId,
      delta: -3,
      reason: InventoryReason.ORDER_CREATED,
      inventoryVersion: 2,
      note: null,
      refType: 'ORDER',
      refId: orderId,
      createdBy: null,
      sourceDocumentId: null,
    };

    const originalEffect = {
      id: BigInt(1),
      operationKey: deductKey,
      variantId,
      orderId,
      delta: -3,
      status: SyncState.PENDING,
      sourceDocumentId: null,
      sourceAcknowledgedAt: null,
      releasedAt: null,
      version: 1,
    };

    const movements = new Map<string, object>([
      [deductKey, originalMovement],
    ]);

    const effects = new Map<string, object>([
      [deductKey, originalEffect],
    ]);

    const tx = {
      $queryRaw: jest.fn(
        (strings: TemplateStringsArray) => {
          const sql = strings.join(' ');

          if (sql.includes('FROM orders')) {
            return [{ id: orderId }];
          }

          if (sql.includes('FROM product_variants')) {
            return [{ id: variantId }];
          }

          if (sql.includes('FROM inventories')) {
            return [{ ...stock }];
          }

          throw new Error('Unexpected SQL query');
        },
      ),

      order: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      },

      payment: {
        count: jest.fn().mockResolvedValue(0),
      },

      kiotvietOrderLink: {
        findUnique: jest.fn().mockResolvedValue(null),
      },

      syncOutbox: {
        count: jest.fn().mockResolvedValue(0),
      },

      syncLog: {
        count: jest.fn().mockResolvedValue(0),
      },

      sourceInvoice: {
        count: jest.fn().mockResolvedValue(0),
      },

      inventory: {
        findUnique: jest.fn(() => ({ ...stock })),

        updateMany: jest.fn(
          ({
            data,
          }: {
            data: {
              quantity: { increment: number };
              version: { increment: number };
              syncStatus: SyncState;
            };
          }) => {
            stock.quantity += data.quantity.increment;
            stock.version += data.version.increment;
            stock.syncStatus = data.syncStatus;

            return { count: 1 };
          },
        ),
      },

      inventoryMovement: {
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: { operationKey: string };
          }) => movements.get(where.operationKey) ?? null,
        ),

        findFirst: jest.fn().mockResolvedValue(null),

        create: jest.fn(
          ({
            data,
          }: {
            data: Prisma.InventoryMovementUncheckedCreateInput;
          }) => {
            const movement = {
              ...data,
              id: 2,
              sourceDocumentId: null,
            };

            movements.set(data.operationKey, movement);

            return movement;
          },
        ),
      },

      pendingInventoryEffect: {
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: { operationKey: string };
          }) => effects.get(where.operationKey) ?? null,
        ),

        create: jest.fn(
          ({
            data,
          }: {
            data: Prisma.PendingInventoryEffectUncheckedCreateInput;
          }) => {
            const effect = {
              ...data,
              id: BigInt(2),
              version: 1,
              sourceDocumentId: null,
              sourceAcknowledgedAt: null,
              releasedAt: null,
            };

            effects.set(data.operationKey, effect);

            return effect;
          },
        ),
      },
    };

    const ledger = new InventoryLedgerService();

    const service = new OrderInventoryService(
      {} as PrismaService,
      ledger,
    );

    const transaction =
      tx as unknown as Prisma.TransactionClient;

    const release = (
      reason:
        | typeof InventoryReason.ORDER_CANCELLED
        | typeof InventoryReason.PAYMENT_EXPIRED =
          InventoryReason.ORDER_CANCELLED,
    ) =>
      service.releaseForOrder(
        transaction,
        orderId,
        reason,
        'VERIFIED_LOCAL_ONLY',
      );

    return {
      service,
      transaction,
      tx,
      stock,
      order,
      originalMovement,
      originalEffect,
      movements,
      effects,
      release,
    };
  }

  function expectNoMutation(
    fixture: ReturnType<typeof setup>,
  ) {
    expect(fixture.stock.quantity).toBe(7);
    expect(fixture.stock.version).toBe(2);

    expect(
      fixture.tx.inventory.updateMany,
    ).not.toHaveBeenCalled();

    expect(
      fixture.tx.inventoryMovement.create,
    ).not.toHaveBeenCalled();

    expect(
      fixture.tx.pendingInventoryEffect.create,
    ).not.toHaveBeenCalled();
  }

  it('REL-01: releases stock for a cancelled order', async () => {
    const fixture = setup();

    const result = await fixture.release();

    expect(fixture.stock.quantity).toBe(10);
    expect(fixture.stock.version).toBe(3);

    expect(result).toHaveLength(1);

    expect(result[0]).toEqual(
      expect.objectContaining({
        operationKey: releaseKey,
        variantId,
        delta: 3,
        inventoryVersion: 3,
        replayed: false,
      }),
    );

    expect(
      fixture.tx.inventory.updateMany,
    ).toHaveBeenCalledTimes(1);

    expect(fixture.movements.get(releaseKey)).toEqual(
      expect.objectContaining({
        delta: 3,
        reason: InventoryReason.ORDER_CANCELLED,
        refType: 'ORDER',
        refId: orderId,
      }),
    );

    expect(fixture.effects.get(releaseKey)).toEqual(
      expect.objectContaining({
        delta: 3,
        orderId,
        status: SyncState.PENDING,
      }),
    );
  });

  it('REL-02: releases stock for expired payment', async () => {
    const fixture = setup();

    const result = await fixture.release(
      InventoryReason.PAYMENT_EXPIRED,
    );

    expect(fixture.stock.quantity).toBe(10);
    expect(result[0].replayed).toBe(false);

    expect(fixture.movements.get(releaseKey)).toEqual(
      expect.objectContaining({
        reason: InventoryReason.PAYMENT_EXPIRED,
        delta: 3,
      }),
    );
  });

  it('REL-03: does not release stock twice', async () => {
    const fixture = setup();

    const first = await fixture.release();
    const second = await fixture.release();

    expect(first[0].replayed).toBe(false);
    expect(second[0].replayed).toBe(true);

    expect(second[0].movementId).toBe(
      first[0].movementId,
    );

    expect(fixture.stock.quantity).toBe(10);
    expect(fixture.stock.version).toBe(3);

    expect(
      fixture.tx.inventory.updateMany,
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.tx.inventoryMovement.create,
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.tx.pendingInventoryEffect.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('REL-04: shares one key across cancellation reasons', async () => {
    const fixture = setup();

    await fixture.release(
      InventoryReason.ORDER_CANCELLED,
    );

    const replay = await fixture.release(
      InventoryReason.PAYMENT_EXPIRED,
    );

    expect(replay[0].replayed).toBe(true);
    expect(fixture.stock.quantity).toBe(10);
    expect(fixture.stock.version).toBe(3);

    expect(
      fixture.tx.inventory.updateMany,
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.tx.inventoryMovement.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('REL-05: rejects missing original deduction', async () => {
    const fixture = setup();

    fixture.movements.delete(deductKey);
    fixture.effects.delete(deductKey);

    await expect(
      fixture.release(),
    ).rejects.toThrow(
      'Không tìm thấy chứng từ trừ tồn gốc.',
    );

    expectNoMutation(fixture);
  });

  it('REL-06: rejects missing original pending effect', async () => {
    const fixture = setup();

    fixture.effects.delete(deductKey);

    await expect(
      fixture.release(),
    ).rejects.toThrow(
      'Sổ biến động và tác động chờ không nhất quán.',
    );

    expectNoMutation(fixture);
  });

  it('REL-07: rejects mismatched deduction quantity', async () => {
    const fixture = setup();

    fixture.originalMovement.delta = -4;

    await expect(
      fixture.release(),
    ).rejects.toThrow(
      'Mã nghiệp vụ đã được sử dụng với dữ liệu khác.',
    );

    expectNoMutation(fixture);
  });

  it('REL-08: rejects an externally linked order', async () => {
    const fixture = setup();

    fixture.tx.kiotvietOrderLink.findUnique
      .mockResolvedValue({
        orderId,
        kiotvietOrderId: 'KV-100',
      });

    await expect(
      fixture.release(),
    ).rejects.toThrow(
      'Đơn có dấu vết đồng bộ nguồn.',
    );

    expectNoMutation(fixture);
  });

  it('REL-09: rejects an order that is not cancelled', async () => {
    const fixture = setup();

    fixture.order.status = 'AWAITING_CONFIRMATION';

    await expect(
      fixture.release(),
    ).rejects.toThrow(
      'Trạng thái đơn không cho phép hoàn tồn.',
    );

    expectNoMutation(fixture);
  });

  it('REL-10: rejects unresolved payments', async () => {
    const fixture = setup();

    fixture.tx.payment.count.mockResolvedValue(1);

    await expect(
      fixture.release(
        InventoryReason.PAYMENT_EXPIRED,
      ),
    ).rejects.toThrow(
      'Giao dịch thanh toán chưa được xử lý dứt điểm.',
    );

    expectNoMutation(fixture);
  });

  it('REL-11: rejects inventory needing reconciliation', async () => {
    const fixture = setup();

    fixture.stock.syncStatus =
      SyncState.NEEDS_RECONCILIATION;

    await expect(
      fixture.release(),
    ).rejects.toThrow(
      'Tồn kho đang cần đối soát nguồn.',
    );

    expectNoMutation(fixture);
  });

  it('REL-12: rejects unverified source disposition', async () => {
    const fixture = setup();

    await expect(
      fixture.service.releaseForOrder(
        fixture.transaction,
        orderId,
        InventoryReason.ORDER_CANCELLED,
        'UNKNOWN' as never,
      ),
    ).rejects.toThrow(
      'Chưa xác minh được trạng thái tồn kho tại nguồn.',
    );

    expectNoMutation(fixture);
  });
});

describe('OrderInventoryService - availability and deduction', () => {
  const orderId = 100;
  const variantId = 5;

  function setup() {
    const stock = {
      quantity: 10,
      version: 1,
      syncStatus: SyncState.CONFIRMED as SyncState,
    };

    const order = {
      status: 'AWAITING_PAYMENT',
      deliveryStatus: 'NOT_SHIPPED',
      items: [{ variantId, quantity: 3 }],
    };

    const prisma = {
      productVariant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: variantId,
            inventory: { quantity: 10 },
          },
        ]),
      },
    };

    const tx = {
      $queryRaw: jest.fn(
        (strings: TemplateStringsArray, id: number) => {
          const sql = strings.join(' ');

          if (sql.includes('FROM orders')) {
            return [{ id }];
          }

          if (sql.includes('FROM product_variants')) {
            return [{ id }];
          }

          if (sql.includes('FROM inventories')) {
            return [{ ...stock }];
          }

          throw new Error('Unexpected SQL query');
        },
      ),

      order: {
        findUniqueOrThrow: jest.fn()
          .mockResolvedValue(order),
      },

      productVariant: {
        findFirst: jest.fn()
          .mockResolvedValue({ id: variantId }),
      },

      inventory: {
        updateMany: jest.fn()
          .mockResolvedValue({ count: 1 }),
      },
    };

    const ledger = {
      findRecordedOperation: jest.fn()
        .mockResolvedValue(null),

      appendPendingMovement: jest.fn()
        .mockImplementation(
          (
            _tx: unknown,
            input: {
              operationKey: string;
              variantId: number;
              delta: number;
            },
            version: number,
          ) => ({
            operationKey: input.operationKey,
            variantId: input.variantId,
            movementId: '1',
            pendingEffectId: '1',
            inventoryVersion: version,
            delta: input.delta,
          }),
        ),
    };

    const service = new OrderInventoryService(
      prisma as unknown as PrismaService,
      ledger as unknown as InventoryLedgerService,
    );

    const transaction =
      tx as unknown as Prisma.TransactionClient;

    return {
      service,
      transaction,
      prisma,
      tx,
      ledger,
      stock,
      order,
      deduct: () =>
        service.deductForOrder(
          transaction,
          orderId,
        ),
    };
  }

  it('AVL-01: accepts sufficient available stock', async () => {
    const f = setup();

    await expect(
      f.service.assertAvailable([
        { variantId, quantity: 3 },
      ]),
    ).resolves.toBeUndefined();

    expect(
      f.prisma.productVariant.findMany,
    ).toHaveBeenCalledTimes(1);
  });

  it('AVL-02: rejects insufficient available stock', async () => {
    const f = setup();

    await expect(
      f.service.assertAvailable([
        { variantId, quantity: 11 },
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
      }),
    });
  });

  it('AVL-03: aggregates duplicate SKU quantities', async () => {
    const f = setup();

    await expect(
      f.service.assertAvailable([
        { variantId, quantity: 6 },
        { variantId, quantity: 5 },
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
      }),
    });
  });

  it('AVL-04: rejects empty items', async () => {
    const f = setup();

    await expect(
      f.service.assertAvailable([]),
    ).rejects.toThrow(
      'Danh sách sản phẩm không hợp lệ.',
    );

    expect(
      f.prisma.productVariant.findMany,
    ).not.toHaveBeenCalled();
  });

  it('AVL-05: rejects invalid quantity', async () => {
    const f = setup();

    await expect(
      f.service.assertAvailable([
        { variantId, quantity: -1 },
      ]),
    ).rejects.toThrow(
      'variantId hoặc số lượng không hợp lệ.',
    );

    expect(
      f.prisma.productVariant.findMany,
    ).not.toHaveBeenCalled();
  });

  it('AVL-06: rejects unavailable SKU', async () => {
    const f = setup();

    f.prisma.productVariant.findMany
      .mockResolvedValue([]);

    await expect(
      f.service.assertAvailable([
        { variantId, quantity: 1 },
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
      }),
    });
  });

  it('DED-01: deducts stock and records the operation', async () => {
    const f = setup();

    const result = await f.deduct();

    expect(result).toHaveLength(1);

    expect(result[0]).toEqual(
      expect.objectContaining({
        operationKey:
          'M03-ORDER-100-SKU-5-DEDUCT',
        delta: -3,
        inventoryVersion: 2,
        replayed: false,
      }),
    );

    expect(
      f.tx.inventory.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variantId,
          version: 1,
          quantity: { gte: 3 },
        }),
        data: expect.objectContaining({
          quantity: { decrement: 3 },
          version: { increment: 1 },
          syncStatus: SyncState.PENDING,
        }),
      }),
    );

    expect(
      f.ledger.appendPendingMovement,
    ).toHaveBeenCalledWith(
      f.transaction,
      expect.objectContaining({
        orderId,
        variantId,
        delta: -3,
        reason: InventoryReason.ORDER_CREATED,
      }),
      2,
    );
  });

  it('DED-02: rejects insufficient stock without mutation', async () => {
    const f = setup();

    f.stock.quantity = 2;

    await expect(
      f.deduct(),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
      }),
    });

    expect(
      f.tx.inventory.updateMany,
    ).not.toHaveBeenCalled();

    expect(
      f.ledger.appendPendingMovement,
    ).not.toHaveBeenCalled();
  });

  it('DED-03: replays an existing deduction without mutation', async () => {
    const f = setup();

    f.ledger.findRecordedOperation
      .mockResolvedValue({
        operationKey:
          'M03-ORDER-100-SKU-5-DEDUCT',
        variantId,
        delta: -3,
        inventoryVersion: 2,
        movementId: '1',
        pendingEffectId: '1',
      });

    const result = await f.deduct();

    expect(result[0].replayed).toBe(true);

    expect(
      f.tx.inventory.updateMany,
    ).not.toHaveBeenCalled();

    expect(
      f.ledger.appendPendingMovement,
    ).not.toHaveBeenCalled();
  });

  it('DED-04: rejects invalid order status', async () => {
    const f = setup();

    f.order.status = 'CANCELLED';

    await expect(
      f.deduct(),
    ).rejects.toThrow(
      'Trạng thái đơn không cho phép trừ tồn.',
    );

    expect(
      f.tx.inventory.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('DED-05: locks SKUs in ascending ID order', async () => {
    const f = setup();

    f.order.items = [
      { variantId: 9, quantity: 2 },
      { variantId: 3, quantity: 1 },
      { variantId: 5, quantity: 2 },
      { variantId: 3, quantity: 2 },
    ];

    const result = await f.deduct();

    const lockedIds = f.tx.$queryRaw.mock.calls
      .filter(
        ([strings]) =>
          strings.join(' ')
            .includes('FROM product_variants'),
      )
      .map(([, id]) => id);

    expect(lockedIds).toEqual([3, 5, 9]);

    expect(
      result.map(item => item.variantId),
    ).toEqual([3, 5, 9]);

    expect(
      result.map(item => item.delta),
    ).toEqual([-3, -2, -2]);
  });

  it('DED-06: rejects inactive SKU', async () => {
    const f = setup();

    f.tx.productVariant.findFirst
      .mockResolvedValue(null);

    await expect(
      f.deduct(),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
      }),
    });

    expect(
      f.tx.inventory.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('DED-07: rejects inventory version conflict', async () => {
    const f = setup();

    f.tx.inventory.updateMany
      .mockResolvedValue({ count: 0 });

    await expect(
      f.deduct(),
    ).rejects.toThrow(
      'Tồn kho đã thay đổi. Vui lòng kiểm tra lại.',
    );

    expect(
      f.ledger.appendPendingMovement,
    ).not.toHaveBeenCalled();
  });

  it('DED-08: rejects a missing order', async () => {
    const f = setup();

    f.tx.$queryRaw.mockReturnValueOnce([]);

    await expect(
      f.deduct(),
    ).rejects.toThrow(
      'Đơn hàng không tồn tại.',
    );

    expect(
      f.tx.inventory.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('DED-09: preserves reconciliation state', async () => {
    const f = setup();

    f.stock.syncStatus =
      SyncState.NEEDS_RECONCILIATION;

    await f.deduct();

    expect(
      f.tx.inventory.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          syncStatus:
            SyncState.NEEDS_RECONCILIATION,
        }),
      }),
    );
  });

  it('DED-10: rejects inventory version overflow', async () => {
    const f = setup();

    f.stock.version = 2147483647;

    await expect(
      f.deduct(),
    ).rejects.toThrow(
      'Version tồn kho vượt giới hạn cập nhật.',
    );

    expect(
      f.tx.inventory.updateMany,
    ).not.toHaveBeenCalled();

    expect(
      f.ledger.appendPendingMovement,
    ).not.toHaveBeenCalled();
  });
});
