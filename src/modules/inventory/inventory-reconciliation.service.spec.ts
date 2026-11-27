import { Prisma, SyncState } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { InventoryReconciliationService } from './inventory-reconciliation.service';

describe('BE-02 M03 InventoryReconciliationService', () => {
  const observedAt = new Date('2026-11-26T08:00:00Z');

  const identity = {
    adjustmentId: 10,
    variantId: 1,
    expectedInventoryVersion: 3,
  };

  const input = {
    ...identity,
    sourceVariantId: 'KV-SKU-1',
    sourceDocumentId: 'KV-ADJUST-1',
    sourceVersion: 'V2',
    sourceQuantity: 8,
    observedAt,
    confirmedEffects: [
      {
        operationKey: 'ORDER-A',
        expectedVersion: 1,
        sourceDocumentId: 'KV-ORDER-A',
      },
    ],
  };

  const inventory = {
    variantId: 1,
    quantity: 7,
    sourceQuantity: 10,
    sourceVersion: 'V1',
    version: 3,
    syncStatus: SyncState.PENDING,
    lastConfirmedAt: new Date('2026-11-26T07:00:00Z'),
  };

  const adjustment = {
    id: 10,
    variantId: 1,
    actorId: 1,
    operationKey: 'ADJUST-001',
    expectedVersion: 3,
    requestedQuantity: 8,
    reason: 'Inventory reconciliation test',
    status: SyncState.PENDING,
    sourceDocumentId: null,
    sourceVersion: null,
    resultQuantity: null,
  };

  const tx = {
    $queryRaw: jest.fn(),
    productVariant: {
      findUnique: jest.fn(),
    },
    inventory: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    inventoryAdjustment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    pendingInventoryEffect: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn(),
  };

  const pendingMock = {
    releaseConfirmed: jest.fn(),
  };

  const service = new InventoryReconciliationService(
    prismaMock as unknown as PrismaService,
    pendingMock as unknown as PendingInventoryEffectService,
  );

  function expectNoWrites() {
    expect(tx.inventory.update).not.toHaveBeenCalled();
    expect(tx.inventoryAdjustment.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  }

  function mockConfirmed() {
    tx.inventoryAdjustment.findUnique.mockResolvedValue({
      ...adjustment,
      status: SyncState.CONFIRMED,
      sourceDocumentId: input.sourceDocumentId,
      sourceVersion: input.sourceVersion,
      resultQuantity: input.sourceQuantity,
    });

    tx.pendingInventoryEffect.findUnique.mockResolvedValue({
      variantId: 1,
      status: SyncState.CONFIRMED,
      sourceDocumentId: 'KV-ORDER-A',
      releasedAt: observedAt,
    });
  }

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    tx.$queryRaw.mockResolvedValue([{ id: 1, version: 3 }]);

    tx.productVariant.findUnique.mockResolvedValue({
      id: 1,
      kiotvietVariantId: 'KV-SKU-1',
    });

    tx.inventory.findUniqueOrThrow.mockResolvedValue(inventory);

    tx.inventoryAdjustment.findUnique.mockResolvedValue(adjustment);

    tx.inventoryAdjustment.findFirst.mockResolvedValue(null);

    tx.pendingInventoryEffect.findMany.mockResolvedValue([
      {
        delta: -1,
        status: SyncState.PENDING,
      },
    ]);

    pendingMock.releaseConfirmed.mockResolvedValue({
      status: SyncState.CONFIRMED,
    });

    tx.inventory.update.mockResolvedValue({
      ...inventory,
      sourceQuantity: 8,
      quantity: 7,
      version: 4,
    });

    tx.inventoryAdjustment.update.mockResolvedValue({
      ...adjustment,
      status: SyncState.CONFIRMED,
    });
  });

  // 01. Successful reconciliation.

  it('CONFIRM: updates stock and records movement', async () => {
    const result = await service.confirmAdjustment(input);

    expect(result.replayed).toBe(false);

    expect(pendingMock.releaseConfirmed).toHaveBeenCalledWith(
      tx,
      {
        operationKey: 'ORDER-A',
        variantId: 1,
        expectedVersion: 1,
        sourceDocumentId: 'KV-ORDER-A',
        acknowledgedAt: observedAt,
      },
    );

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { variantId: 1 },
      data: {
        quantity: 7,
        sourceQuantity: 8,
        sourceVersion: 'V2',
        lastConfirmedAt: observedAt,
        syncStatus: SyncState.PENDING,
        version: { increment: 1 },
      },
    });

    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationKey: 'ADJUST-001',
        delta: 0,
        reason: 'ADMIN_ADJUST',
        inventoryVersion: 4,
      }),
    });

    expect(tx.inventoryAdjustment.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        status: SyncState.CONFIRMED,
        resultQuantity: 8,
        sourceDocumentId: 'KV-ADJUST-1',
      }),
    });

    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel:
          Prisma.TransactionIsolationLevel.ReadCommitted,
      }),
    );
  });

  // 02. No pending effects.

  it('CONFIRM: no remaining effects becomes CONFIRMED', async () => {
    tx.pendingInventoryEffect.findMany.mockResolvedValue([]);

    await service.confirmAdjustment(input);

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { variantId: 1 },
      data: expect.objectContaining({
        quantity: 8,
        syncStatus: SyncState.CONFIRMED,
      }),
    });
  });

  // 03. Preserve unresolved reconciliation.

  it('CONFIRM: unresolved effect keeps reconciliation state', async () => {
    tx.pendingInventoryEffect.findMany.mockResolvedValue([
      {
        delta: -1,
        status: SyncState.NEEDS_RECONCILIATION,
      },
    ]);

    await service.confirmAdjustment(input);

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { variantId: 1 },
      data: expect.objectContaining({
        quantity: 7,
        syncStatus: SyncState.NEEDS_RECONCILIATION,
      }),
    });
  });

  // 04. Negative stock safeguard.

  it('CONFIRM: negative calculated stock is clamped', async () => {
    tx.pendingInventoryEffect.findMany.mockResolvedValue([
      {
        delta: -20,
        status: SyncState.PENDING,
      },
    ]);

    await service.confirmAdjustment(input);

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { variantId: 1 },
      data: expect.objectContaining({
        quantity: 0,
        syncStatus: SyncState.NEEDS_RECONCILIATION,
      }),
    });
  });

  // 05. Overflow.

  it('CONFIRM: overflow returns conflict', async () => {
    tx.pendingInventoryEffect.findMany.mockResolvedValue([
      {
        delta: 1,
        status: SyncState.PENDING,
      },
    ]);

    await expect(service.confirmAdjustment({
      ...input,
      sourceQuantity: 2147483647,
      confirmedEffects: [],
    })).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 06. Idempotency.

  it('REPLAY: confirmed adjustment does not write again', async () => {
    mockConfirmed();

    const result = await service.confirmAdjustment(input);

    expect(result.replayed).toBe(true);
    expectNoWrites();

    expect(pendingMock.releaseConfirmed).not.toHaveBeenCalled();
  });

  // 07. Conflicting replay.

  it('REPLAY: changed result is rejected', async () => {
    mockConfirmed();

    await expect(service.confirmAdjustment({
      ...input,
      sourceQuantity: 99,
    })).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 08. Unconfirmed operation in replay.

  it('REPLAY: unrelated unconfirmed effect is rejected', async () => {
    mockConfirmed();

    tx.pendingInventoryEffect.findUnique.mockResolvedValue(null);

    await expect(service.confirmAdjustment(input))
      .rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 09. Invalid local version.

  it('VERSION: stale inventory version is rejected', async () => {
    await expect(service.confirmAdjustment({
      ...input,
      expectedInventoryVersion: 2,
    })).rejects.toMatchObject({
      status: 409,
      response: { code: 'VERSION_CONFLICT' },
    });

    expectNoWrites();
  });

  // 10. Wrong source SKU.

  it('SOURCE: wrong source SKU is rejected', async () => {
    await expect(service.confirmAdjustment({
      ...input,
      sourceVariantId: 'OTHER-SKU',
    })).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 11. Stale observation.

  it('SOURCE: old observation is rejected', async () => {
    await expect(service.confirmAdjustment({
      ...input,
      observedAt: inventory.lastConfirmedAt,
    })).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 12. Duplicate source version.

  it('SOURCE: duplicate source version is rejected', async () => {
    await expect(service.confirmAdjustment({
      ...input,
      sourceVersion: 'V1',
    })).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 13. Duplicate source document.

  it('SOURCE: previously used document is rejected', async () => {
    tx.inventoryAdjustment.findFirst.mockResolvedValue({
      id: 11,
    });

    await expect(service.confirmAdjustment(input))
      .rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 14. Missing adjustment.

  it('ERROR: missing adjustment returns 404', async () => {
    tx.inventoryAdjustment.findUnique.mockResolvedValue(null);

    await expect(service.confirmAdjustment(input))
      .rejects.toMatchObject({ status: 404 });

    expectNoWrites();
  });

  // 15. Pending effect failure.

  it('ERROR: pending effect failure stops reconciliation', async () => {
    pendingMock.releaseConfirmed.mockRejectedValue(
      new Error('Effect update failed'),
    );

    await expect(service.confirmAdjustment(input))
      .rejects.toThrow('Effect update failed');

    expectNoWrites();
  });

  // 16. Uncertain source result.

  it('STATE: uncertain result preserves stock values', async () => {
    await service.markNeedsReconciliation(identity);

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { variantId: 1 },
      data: {
        syncStatus: SyncState.NEEDS_RECONCILIATION,
        version: { increment: 1 },
      },
    });

    expect(tx.inventoryAdjustment.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        status: SyncState.NEEDS_RECONCILIATION,
      },
    });

    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(pendingMock.releaseConfirmed).not.toHaveBeenCalled();
  });

  // 17. Repeated uncertain result.

  it('STATE: repeated reconciliation does not write again', async () => {
    tx.inventory.findUniqueOrThrow.mockResolvedValue({
      ...inventory,
      syncStatus: SyncState.NEEDS_RECONCILIATION,
    });

    tx.inventoryAdjustment.findUnique.mockResolvedValue({
      ...adjustment,
      status: SyncState.NEEDS_RECONCILIATION,
    });

    const result = await service.markNeedsReconciliation(identity);

    expect(result.replayed).toBe(true);
    expectNoWrites();
  });

  // 18. Confirmed adjustment cannot be reopened.

  it('STATE: confirmed adjustment cannot be reopened', async () => {
    mockConfirmed();

    await expect(service.markNeedsReconciliation(identity))
      .rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  // 19. Duplicate confirmed effects.

  it('VALIDATION: duplicate effect keys are rejected', async () => {
    await expect(service.confirmAdjustment({
      ...input,
      confirmedEffects: [
        input.confirmedEffects[0],
        input.confirmedEffects[0],
      ],
    })).rejects.toMatchObject({ status: 400 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // 20. Invalid source quantity.

  it('VALIDATION: negative source quantity is rejected', async () => {
    await expect(service.confirmAdjustment({
      ...input,
      sourceQuantity: -1,
    })).rejects.toMatchObject({ status: 400 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
