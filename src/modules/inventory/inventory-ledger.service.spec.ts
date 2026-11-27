import {
  InventoryReason,
  Prisma,
  SyncState,
} from '@prisma/client';

import { InventoryLedgerService } from './inventory-ledger.service';

import type {
  PendingMovementInput,
} from './inventory-ledger.service';

describe('BE-02 M03 InventoryLedgerService', () => {
  let service: InventoryLedgerService;

  const tx = {
    inventory: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },

    inventoryMovement: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },

    pendingInventoryEffect: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },

    $executeRaw: jest.fn(),
  };

  const client =
    tx as unknown as Prisma.TransactionClient;

  const makeInput = (
    overrides: Partial<PendingMovementInput> = {},
  ): PendingMovementInput => ({
    operationKey: 'M03-ORDER-1001-SKU-1',
    variantId: 1,
    orderId: 1001,
    delta: -2,
    reason: InventoryReason.ORDER_CREATED,
    note: 'Web order 1001',
    refType: 'ORDER',
    refId: 1001,
    createdBy: null,
    ...overrides,
  });

  const makeMovement = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 10,
    operationKey: 'M03-ORDER-1001-SKU-1',
    variantId: 1,
    delta: -2,
    reason: InventoryReason.ORDER_CREATED,
    inventoryVersion: 2,
    note: 'Web order 1001',
    refType: 'ORDER',
    refId: 1001,
    createdBy: null,
    ...overrides,
  });

  const makeEffect = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: BigInt('9007199254740993'),
    operationKey: 'M03-ORDER-1001-SKU-1',
    variantId: 1,
    orderId: 1001,
    delta: -2,
    status: SyncState.PENDING,
    releasedAt: null,
    ...overrides,
  });

  const expectedOperation = {
    operationKey: 'M03-ORDER-1001-SKU-1',
    variantId: 1,
    movementId: '10',
    pendingEffectId: '9007199254740993',
    inventoryVersion: 2,
    delta: -2,
  };

  function mockRecordedOperation() {
    tx.inventoryMovement.findUnique.mockResolvedValue(
      makeMovement(),
    );

    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect(),
    );
  }

  function expectNoWrites() {
    expect(tx.inventoryMovement.create)
      .not.toHaveBeenCalled();

    expect(tx.pendingInventoryEffect.create)
      .not.toHaveBeenCalled();

    expect(tx.inventory.update)
      .not.toHaveBeenCalled();

    expect(tx.inventory.updateMany)
      .not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.resetAllMocks();

    service = new InventoryLedgerService();

    tx.inventoryMovement.findUnique.mockResolvedValue(null);

    tx.pendingInventoryEffect.findUnique.mockResolvedValue(null);

    tx.inventory.findUnique.mockResolvedValue({
      version: 2,
      quantity: 8,
    });

    tx.inventoryMovement.create.mockResolvedValue(
      makeMovement(),
    );

    tx.pendingInventoryEffect.create.mockResolvedValue(
      makeEffect(),
    );
  });

  // 1. OPERATION LOOKUP

  it('LOOKUP: new operation returns null without writes', async () => {
    const result = await service.findRecordedOperation(
      client,
      makeInput(),
    );

    expect(result).toBeNull();

    expect(tx.inventoryMovement.findUnique)
      .toHaveBeenCalledWith({
        where: {
          operationKey: 'M03-ORDER-1001-SKU-1',
        },
      });

    expect(tx.pendingInventoryEffect.findUnique)
      .toHaveBeenCalledWith({
        where: {
          operationKey: 'M03-ORDER-1001-SKU-1',
        },
      });

    expectNoWrites();
  });

  it('LOOKUP: matching operation returns original result', async () => {
    mockRecordedOperation();

    const result = await service.findRecordedOperation(
      client,
      makeInput(),
    );

    expect(result).toEqual(expectedOperation);

    expectNoWrites();
  });

  it.each([
    SyncState.PENDING,
    SyncState.CONFIRMED,
    SyncState.NEEDS_RECONCILIATION,
  ])(
    'LOOKUP: operation remains recorded in state %s',
    async (status) => {
      mockRecordedOperation();

      tx.pendingInventoryEffect.findUnique.mockResolvedValue(
        makeEffect({ status }),
      );

      expect(
        await service.findRecordedOperation(
          client,
          makeInput(),
        ),
      ).toEqual(expectedOperation);

      expectNoWrites();
    },
  );

  it('LOOKUP: released effect cannot be applied again', async () => {
    mockRecordedOperation();

    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect({
        status: SyncState.CONFIRMED,
        releasedAt: new Date('2026-11-26T07:00:00Z'),
      }),
    );

    expect(
      await service.findRecordedOperation(
        client,
        makeInput(),
      ),
    ).toEqual(expectedOperation);

    expectNoWrites();
  });

  // 2. INCONSISTENT LEDGER DATA

  it('LOOKUP: movement without effect returns conflict', async () => {
    tx.inventoryMovement.findUnique.mockResolvedValue(
      makeMovement(),
    );

    await expect(
      service.findRecordedOperation(client, makeInput()),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });

    expectNoWrites();
  });

  it('LOOKUP: effect without movement returns conflict', async () => {
    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect(),
    );

    await expect(
      service.findRecordedOperation(client, makeInput()),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });

    expectNoWrites();
  });

  it.each([
    { variantId: 2 },
    { orderId: 1002 },
    { delta: -3 },
    { note: 'Different note' },
    { refType: 'OTHER' },
    { refId: 1002 },
    { createdBy: 2 },
  ] as Partial<PendingMovementInput>[])(
    'LOOKUP: reused key with different payload %j returns conflict',
    async (overrides) => {
      mockRecordedOperation();

      await expect(
        service.findRecordedOperation(
          client,
          makeInput(overrides),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'CONFLICT' },
      });

      expectNoWrites();
    },
  );

  // 3. APPEND MOVEMENT AND EFFECT

  it('APPEND: writes matching ledger and pending effect', async () => {
    const result = await service.appendPendingMovement(
      client,
      makeInput(),
      2,
    );

    expect(result).toEqual(expectedOperation);

    expect(tx.inventory.findUnique)
      .toHaveBeenCalledWith({
        where: { variantId: 1 },
        select: {
          version: true,
          quantity: true,
        },
      });

    expect(tx.inventoryMovement.create)
      .toHaveBeenCalledTimes(1);

    expect(tx.inventoryMovement.create)
      .toHaveBeenCalledWith({
        data: {
          operationKey: 'M03-ORDER-1001-SKU-1',
          variantId: 1,
          delta: -2,
          reason: InventoryReason.ORDER_CREATED,
          inventoryVersion: 2,
          note: 'Web order 1001',
          refType: 'ORDER',
          refId: 1001,
          createdBy: null,
        },
      });

    expect(tx.pendingInventoryEffect.create)
      .toHaveBeenCalledTimes(1);

    expect(tx.pendingInventoryEffect.create)
      .toHaveBeenCalledWith({
        data: {
          operationKey: 'M03-ORDER-1001-SKU-1',
          variantId: 1,
          orderId: 1001,
          delta: -2,
          status: SyncState.PENDING,
        },
      });

    expect(tx.inventory.update)
      .not.toHaveBeenCalled();

    expect(tx.inventory.updateMany)
      .not.toHaveBeenCalled();

    expect(
      tx.inventoryMovement.create.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.pendingInventoryEffect.create.mock.invocationCallOrder[0],
    );
  });

  it.each([
    InventoryReason.ORDER_CANCELLED,
    InventoryReason.PAYMENT_EXPIRED,
    InventoryReason.RETURN_RECEIVED,
  ])(
    'APPEND: supports positive delta for %s',
    async (reason) => {
      tx.inventoryMovement.create.mockResolvedValue(
        makeMovement({
          delta: 2,
          reason,
        }),
      );

      tx.pendingInventoryEffect.create.mockResolvedValue(
        makeEffect({ delta: 2 }),
      );

      const result = await service.appendPendingMovement(
        client,
        makeInput({ delta: 2, reason }),
        2,
      );

      expect(result.delta).toBe(2);

      expect(tx.inventoryMovement.create)
        .toHaveBeenCalledWith({
          data: expect.objectContaining({
            delta: 2,
            reason,
          }),
        });

      expect(tx.pendingInventoryEffect.create)
        .toHaveBeenCalledWith({
          data: expect.objectContaining({
            delta: 2,
            status: SyncState.PENDING,
          }),
        });
    },
  );

  it('APPEND: optional metadata defaults to null', async () => {
    await service.appendPendingMovement(
      client,
      makeInput({
        note: undefined,
        refType: undefined,
        refId: undefined,
        createdBy: undefined,
      }),
      2,
    );

    expect(tx.inventoryMovement.create)
      .toHaveBeenCalledWith({
        data: expect.objectContaining({
          note: null,
          refType: null,
          refId: null,
          createdBy: null,
        }),
      });
  });

  it('APPEND: duplicate operation rejects new writes', async () => {
    mockRecordedOperation();

    await expect(
      service.appendPendingMovement(
        client,
        makeInput(),
        2,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });

    expectNoWrites();
  });

  // 4. INVENTORY AND VERSION VALIDATION

  it('APPEND: missing inventory returns 404', async () => {
    tx.inventory.findUnique.mockResolvedValue(null);

    await expect(
      service.appendPendingMovement(
        client,
        makeInput(),
        2,
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });

    expectNoWrites();
  });

  it('APPEND: stale inventory version returns 409', async () => {
    tx.inventory.findUnique.mockResolvedValue({
      version: 3,
      quantity: 8,
    });

    await expect(
      service.appendPendingMovement(
        client,
        makeInput(),
        2,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'VERSION_CONFLICT' },
    });

    expectNoWrites();
  });

  it('APPEND: negative sellable stock returns conflict', async () => {
    tx.inventory.findUnique.mockResolvedValue({
      version: 2,
      quantity: -1,
    });

    await expect(
      service.appendPendingMovement(
        client,
        makeInput(),
        2,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });

    expectNoWrites();
  });

  it('APPEND: zero sellable stock is valid', async () => {
    tx.inventory.findUnique.mockResolvedValue({
      version: 2,
      quantity: 0,
    });

    expect(
      await service.appendPendingMovement(
        client,
        makeInput(),
        2,
      ),
    ).toEqual(expectedOperation);
  });

  it.each([
    0,
    -1,
    1.5,
    2147483648,
    NaN,
  ])(
    'VALIDATION: invalid inventory version %s',
    async (version) => {
      await expect(
        service.appendPendingMovement(
          client,
          makeInput(),
          version,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'VALIDATION_ERROR' },
      });

      expect(tx.inventory.findUnique)
        .not.toHaveBeenCalled();

      expectNoWrites();
    },
  );

  // 5. INPUT VALIDATION

  const invalidInputs: Partial<PendingMovementInput>[] = [
    { operationKey: '' },
    { operationKey: '   ' },
    { operationKey: ' key' },
    { operationKey: 'x'.repeat(192) },
    { variantId: 0 },
    { variantId: -1 },
    { variantId: 2147483648 },
    { orderId: 0 },
    { orderId: 1.5 },
    { delta: 0 },
    { delta: 1.5 },
    { delta: -2147483648 },
    { delta: 2147483648 },
    { delta: 2 },
    {
      reason: InventoryReason.ORDER_CANCELLED,
      delta: -2,
    },
    {
      reason: InventoryReason.PAYMENT_EXPIRED,
      delta: -2,
    },
    {
      reason: InventoryReason.RETURN_RECEIVED,
      delta: -2,
    },
    { reason: InventoryReason.ADMIN_ADJUST },
    { note: 'x'.repeat(256) },
    { refType: 'x'.repeat(31) },
    { refId: 0 },
    { createdBy: -1 },
  ];

  it.each(invalidInputs)(
    'VALIDATION: rejects invalid input %j',
    async (overrides) => {
      await expect(
        service.appendPendingMovement(
          client,
          makeInput(overrides),
          2,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'VALIDATION_ERROR' },
      });

      expect(tx.inventoryMovement.findUnique)
        .not.toHaveBeenCalled();

      expect(tx.pendingInventoryEffect.findUnique)
        .not.toHaveBeenCalled();

      expectNoWrites();
    },
  );

  // 6. DATABASE FAILURES MUST PROPAGATE

  it('ERROR: movement write failure prevents effect write', async () => {
    tx.inventoryMovement.create.mockRejectedValueOnce(
      new Error('Movement write failed'),
    );

    await expect(
      service.appendPendingMovement(
        client,
        makeInput(),
        2,
      ),
    ).rejects.toThrow('Movement write failed');

    expect(tx.pendingInventoryEffect.create)
      .not.toHaveBeenCalled();
  });

  it('ERROR: effect write failure propagates to caller transaction', async () => {
    tx.pendingInventoryEffect.create.mockRejectedValueOnce(
      new Error('Pending effect write failed'),
    );

    await expect(
      service.appendPendingMovement(
        client,
        makeInput(),
        2,
      ),
    ).rejects.toThrow('Pending effect write failed');

    expect(tx.inventoryMovement.create)
      .toHaveBeenCalledTimes(1);

    expect(tx.pendingInventoryEffect.create)
      .toHaveBeenCalledTimes(1);

    expect(tx.inventoryMovement.delete)
      .not.toHaveBeenCalled();
  });

  it('ERROR: operation lookup failure propagates', async () => {
    tx.inventoryMovement.findUnique.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );

    await expect(
      service.findRecordedOperation(
        client,
        makeInput(),
      ),
    ).rejects.toThrow('Database unavailable');

    expectNoWrites();
  });
});
