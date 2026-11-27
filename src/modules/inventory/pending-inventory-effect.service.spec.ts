import { Prisma, SyncState } from '@prisma/client';

import { PendingInventoryEffectService } from './pending-inventory-effect.service';

describe('BE-02 M03 PendingInventoryEffectService', () => {
  const service = new PendingInventoryEffectService();

  const tx = {
    pendingInventoryEffect: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    inventoryMovement: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    inventory: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const client = tx as unknown as Prisma.TransactionClient;

  const identity = {
    operationKey: 'M03-TEST-001',
    variantId: 1,
    expectedVersion: 1,
  };

  const acknowledgedAt = new Date('2025-01-01T00:00:00Z');

  const confirmation = {
    ...identity,
    sourceDocumentId: 'KV-TEST-001',
    acknowledgedAt,
  };

  const makeEffect = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: BigInt('9007199254740993'),
    operationKey: identity.operationKey,
    variantId: 1,
    delta: -2,
    status: SyncState.PENDING,
    version: 1,
    sourceDocumentId: null,
    sourceAcknowledgedAt: null,
    releasedAt: null,
    ...overrides,
  });

  const makeMovement = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 10,
    operationKey: identity.operationKey,
    variantId: 1,
    delta: -2,
    sourceDocumentId: null,
    ...overrides,
  });

  function mockConfirmed() {
    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect({
        status: SyncState.CONFIRMED,
        version: 2,
        releasedAt: acknowledgedAt,
        sourceAcknowledgedAt: acknowledgedAt,
        sourceDocumentId: confirmation.sourceDocumentId,
      }),
    );

    tx.inventoryMovement.findUnique.mockResolvedValue(
      makeMovement({
        sourceDocumentId: confirmation.sourceDocumentId,
      }),
    );
  }

  function expectNoWrites() {
    expect(tx.pendingInventoryEffect.updateMany)
      .not.toHaveBeenCalled();

    expect(tx.inventoryMovement.updateMany)
      .not.toHaveBeenCalled();

    expect(tx.inventory.update)
      .not.toHaveBeenCalled();

    expect(tx.inventory.updateMany)
      .not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.resetAllMocks();

    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect(),
    );

    tx.inventoryMovement.findUnique.mockResolvedValue(
      makeMovement(),
    );

    tx.pendingInventoryEffect.updateMany
      .mockResolvedValue({ count: 1 });

    tx.inventoryMovement.updateMany
      .mockResolvedValue({ count: 1 });
  });

  it('STATE: PENDING becomes NEEDS_RECONCILIATION', async () => {
    const result = await service.markNeedsReconciliation(
      client,
      identity,
    );

    expect(result).toEqual({
      id: '9007199254740993',
      operationKey: identity.operationKey,
      variantId: 1,
      delta: -2,
      status: SyncState.NEEDS_RECONCILIATION,
      version: 2,
      replayed: false,
    });

    expect(tx.pendingInventoryEffect.updateMany)
      .toHaveBeenCalledWith({
        where: {
          id: BigInt('9007199254740993'),
          variantId: 1,
          version: 1,
          status: SyncState.PENDING,
          releasedAt: null,
        },
        data: {
          status: SyncState.NEEDS_RECONCILIATION,
          version: { increment: 1 },
        },
      });

    expect(tx.inventoryMovement.updateMany)
      .not.toHaveBeenCalled();
  });

  it('STATE: repeated reconciliation is idempotent', async () => {
    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect({
        status: SyncState.NEEDS_RECONCILIATION,
        version: 2,
      }),
    );

    const result = await service.markNeedsReconciliation(
      client,
      identity,
    );

    expect(result.replayed).toBe(true);
    expect(result.version).toBe(2);

    expectNoWrites();
  });

  it.each([
    SyncState.PENDING,
    SyncState.NEEDS_RECONCILIATION,
  ])('STATE: confirms effect from %s', async status => {
    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect({ status }),
    );

    const result = await service.releaseConfirmed(
      client,
      confirmation,
    );

    expect(result.status).toBe(SyncState.CONFIRMED);
    expect(result.version).toBe(2);
    expect(result.replayed).toBe(false);

    expect(tx.pendingInventoryEffect.updateMany)
      .toHaveBeenCalledWith({
        where: {
          id: BigInt('9007199254740993'),
          variantId: 1,
          version: 1,
          status: {
            in: [
              SyncState.PENDING,
              SyncState.NEEDS_RECONCILIATION,
            ],
          },
          releasedAt: null,
        },
        data: {
          status: SyncState.CONFIRMED,
          sourceDocumentId: 'KV-TEST-001',
          sourceAcknowledgedAt: acknowledgedAt,
          releasedAt: expect.any(Date),
          version: { increment: 1 },
        },
      });

    expect(tx.inventoryMovement.updateMany)
      .toHaveBeenCalledWith({
        where: {
          id: 10,
          variantId: 1,
          OR: [
            { sourceDocumentId: null },
            { sourceDocumentId: 'KV-TEST-001' },
          ],
        },
        data: {
          sourceDocumentId: 'KV-TEST-001',
        },
      });

    expect(tx.inventory.updateMany)
      .not.toHaveBeenCalled();
  });

  it('STATE: repeated confirmation does not write again', async () => {
    mockConfirmed();

    const result = await service.releaseConfirmed(
      client,
      confirmation,
    );

    expect(result.replayed).toBe(true);
    expect(result.version).toBe(2);

    expectNoWrites();
  });

  it('STATE: confirmed effect cannot be reopened', async () => {
    mockConfirmed();

    await expect(
      service.markNeedsReconciliation(client, identity),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });

    expectNoWrites();
  });

  it('STATE: different source document is rejected', async () => {
    mockConfirmed();

    await expect(
      service.releaseConfirmed(client, {
        ...confirmation,
        sourceDocumentId: 'OTHER-DOCUMENT',
      }),
    ).rejects.toMatchObject({
      status: 409,
    });

    expectNoWrites();
  });

  it('ERROR: missing effect returns 404', async () => {
    tx.pendingInventoryEffect.findUnique.mockResolvedValue(null);

    await expect(
      service.releaseConfirmed(client, confirmation),
    ).rejects.toMatchObject({ status: 404 });

    expectNoWrites();
  });

  it('ERROR: wrong SKU returns 404', async () => {
    await expect(
      service.releaseConfirmed(client, {
        ...confirmation,
        variantId: 2,
      }),
    ).rejects.toMatchObject({ status: 404 });

    expectNoWrites();
  });

  it('ERROR: missing movement returns conflict', async () => {
    tx.inventoryMovement.findUnique.mockResolvedValue(null);

    await expect(
      service.releaseConfirmed(client, confirmation),
    ).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  it('ERROR: inconsistent delta returns conflict', async () => {
    tx.inventoryMovement.findUnique.mockResolvedValue(
      makeMovement({ delta: -3 }),
    );

    await expect(
      service.releaseConfirmed(client, confirmation),
    ).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  it('ERROR: stale version cannot change state', async () => {
    await expect(
      service.releaseConfirmed(client, {
        ...confirmation,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'VERSION_CONFLICT' },
    });

    expectNoWrites();
  });

  it('ERROR: concurrent version conflict is detected', async () => {
    tx.pendingInventoryEffect.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.releaseConfirmed(client, confirmation),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'VERSION_CONFLICT' },
    });

    expect(tx.inventoryMovement.updateMany)
      .not.toHaveBeenCalled();
  });

  it('ERROR: movement update failure must propagate', async () => {
    tx.inventoryMovement.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.releaseConfirmed(client, confirmation),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('ERROR: released but unconfirmed effect is inconsistent', async () => {
    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect({ releasedAt: acknowledgedAt }),
    );

    await expect(
      service.releaseConfirmed(client, confirmation),
    ).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  it('ERROR: confirmed effect without evidence is inconsistent', async () => {
    tx.pendingInventoryEffect.findUnique.mockResolvedValue(
      makeEffect({ status: SyncState.CONFIRMED }),
    );

    await expect(
      service.releaseConfirmed(client, confirmation),
    ).rejects.toMatchObject({ status: 409 });

    expectNoWrites();
  });

  it.each([
    { operationKey: '' },
    { operationKey: 'x'.repeat(192) },
    { variantId: 0 },
    { expectedVersion: 0 },
    { sourceDocumentId: '' },
    { sourceDocumentId: 'x'.repeat(101) },
    { acknowledgedAt: new Date('invalid') },
    { acknowledgedAt: new Date('2099-01-01T00:00:00Z') },
  ])('VALIDATION: rejects invalid input %j', async overrides => {
    await expect(
      service.releaseConfirmed(client, {
        ...confirmation,
        ...overrides,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_ERROR' },
    });

    expectNoWrites();
  });
});
