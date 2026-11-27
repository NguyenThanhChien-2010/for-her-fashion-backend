import { HttpException } from '@nestjs/common';
import { InventoryReason, SyncState } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { InventoryLedgerService } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { ReturnInventoryService } from './return-inventory.service';
import type { PreparedReturnReceipt } from './return-inventory.service';
import type { VerifiedReturnEvidence } from './return-inventory.contract';

const OBSERVED_AT = new Date('2020-01-03T00:00:00.000Z');

function fixture() {
  const receipt: PreparedReturnReceipt = {
    receiptKind: 'CUSTOMER_RETURN',
    receiptId: 15,
    receiptOperationKey: 'RETURN-15',
    orderId: 101,
    actorId: 9,
    sourceDocumentId: 'KV-RETURN-15',
    receivedAt: new Date('2020-01-02T00:00:00.000Z'),
    lines: [{
      receiptItemId: 601, orderItemId: 201, requestItemId: 401,
      variantId: 301, orderedQuantity: 5, receivedQuantity: 3,
      acceptedQuantity: 3, resalableQuantity: 3,
      operationKey: 'M03-RETURN-RECEIPT-ITEM-601-RESTOCK',
    }],
  };
  const evidence: VerifiedReturnEvidence = {
    receiptKind: 'CUSTOMER_RETURN', receiptId: 15,
    sourceDocumentId: 'KV-RETURN-15',
    snapshots: [{
      variantId: 301, sourceVariantId: 'KV-SKU-301',
      expectedInventoryVersion: 5, restockedQuantity: 3,
      sourceQuantity: 13, sourceVersion: 'source-v2',
      observedAt: new Date(OBSERVED_AT), confirmedEffects: [], notReflectedEffects: [],
    }],
  };
  const inventory = {
    version: 5, quantity: 10, sourceVersion: 'source-v1',
    lastConfirmedAt: new Date('2020-01-01T00:00:00.000Z') as Date | null,
  };
  const mock = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 301 }]),
    productVariant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ kiotvietVariantId: 'KV-SKU-301' }) },
    inventory: { findUniqueOrThrow: jest.fn().mockResolvedValue(inventory), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    returnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    deliveryReturnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    inventoryMovement: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
    pendingInventoryEffect: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
  };
  const ledger = new InventoryLedgerService();
  const pending = new PendingInventoryEffectService();
  const find = jest.spyOn(ledger, 'findRecordedOperation').mockResolvedValue(null);
  const append = jest.spyOn(ledger, 'appendPendingMovement').mockImplementation(
    async (_tx, input, inventoryVersion) => ({
      operationKey: input.operationKey, variantId: input.variantId,
      movementId: String(input.refId), pendingEffectId: `effect-${input.refId}`,
      inventoryVersion, delta: input.delta,
    }),
  );
  const release = jest.spyOn(pending, 'releaseConfirmed').mockImplementation(
    async (_tx, input) => ({
      id: '1', operationKey: input.operationKey, variantId: input.variantId,
      delta: 3, status: SyncState.CONFIRMED, version: input.expectedVersion + 1,
      replayed: false,
    }),
  );
  const service = new ReturnInventoryService(ledger, pending);
  const prepare = jest.spyOn(service, 'prepareReceipt').mockResolvedValue(receipt);
  const tx = mock as unknown as Prisma.TransactionClient;
  return { receipt, evidence, snapshot: evidence.snapshots[0], inventory, mock, service, tx, prepare, find, append, release };
}

type Fixture = ReturnType<typeof fixture>;

function effectFixture(f: Fixture, confirmed = false, delta = -2) {
  const effect = {
    operationKey: 'ORDER-201-DEDUCT', variantId: 301, delta, version: 1,
    status: SyncState.PENDING as SyncState, releasedAt: null as Date | null,
    sourceDocumentId: null as string | null, sourceAcknowledgedAt: null as Date | null,
  };
  const movement = { operationKey: effect.operationKey, variantId: 301, delta, sourceDocumentId: null as string | null };
  f.mock.pendingInventoryEffect.findMany.mockResolvedValueOnce([]).mockResolvedValue([effect]);
  f.mock.inventoryMovement.findMany.mockResolvedValueOnce([]).mockResolvedValue([movement]);
  if (confirmed) {
    f.snapshot.confirmedEffects.push({ operationKey: effect.operationKey, expectedVersion: 1, sourceDocumentId: 'KV-ORDER-201' });
  } else {
    f.snapshot.notReflectedEffects.push({ operationKey: effect.operationKey, expectedVersion: 1 });
  }
  return { effect, movement };
}

function apply(f: Fixture) {
  return f.service.applyVerifiedReturn(f.tx, f.receipt.receiptKind, f.receipt.receiptId, f.evidence);
}

function expectNoWrites(f: Fixture): void {
  expect(f.mock.inventory.updateMany).not.toHaveBeenCalled();
  expect(f.append).not.toHaveBeenCalled();
  expect(f.release).not.toHaveBeenCalled();
}

async function rejectApply(f: Fixture, code = 'CONFLICT'): Promise<void> {
  try {
    await apply(f);
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code} was not thrown`);
}

function secondLine(f: Fixture, separateSku = false, quantity = 2): void {
  f.receipt.lines.push({
    ...f.receipt.lines[0], receiptItemId: 602, orderItemId: 202, requestItemId: 402,
    variantId: separateSku ? 302 : 301, resalableQuantity: quantity,
    operationKey: 'M03-RETURN-RECEIPT-ITEM-602-RESTOCK',
  });
  if (separateSku) {
    f.evidence.snapshots.unshift({ ...f.snapshot, variantId: 302,
      sourceVariantId: 'KV-SKU-302', restockedQuantity: quantity, sourceQuantity: 10 + quantity });
    f.mock.productVariant.findUniqueOrThrow.mockImplementation(async (args: { where: { id: number } }) => ({ kiotvietVariantId: `KV-SKU-${args.where.id}` }));
  } else {
    f.snapshot.restockedQuantity += quantity;
    f.snapshot.sourceQuantity += quantity;
  }
}

function releaseResult(f: Fixture, replayed: boolean, status: SyncState = SyncState.CONFIRMED) {
  return { id: '1', operationKey: f.receipt.lines[0].operationKey,
    variantId: 301, delta: 3, status, version: 2, replayed };
}

describe('ReturnInventoryService - verified return application', () => {
  it('RA-01: returns a recorded result for a new customer return', async () => {
    const f = fixture();
    expect(await apply(f)).toEqual([{ operationKey: f.receipt.lines[0].operationKey,
      variantId: 301, movementId: '601', pendingEffectId: 'effect-601',
      inventoryVersion: 6, delta: 3, receiptKind: 'CUSTOMER_RETURN', receiptItemId: 601, replayed: false }]);
  });
  it('RA-02: sets projected stock and source fields with optimistic version guard', async () => {
    const f = fixture(); await apply(f);
    expect(f.mock.inventory.updateMany).toHaveBeenCalledTimes(1);
    expect(f.mock.inventory.updateMany).toHaveBeenCalledWith({
      where: { variantId: 301, version: 5, quantity: 10 },
      data: { quantity: 13, sourceQuantity: 13, sourceVersion: 'source-v2',
        lastConfirmedAt: OBSERVED_AT, syncStatus: SyncState.CONFIRMED, version: { increment: 1 } },
    });
  });
  it('RA-03: records correct return movement identity and delta', async () => {
    const f = fixture(); await apply(f);
    const input = { operationKey: f.receipt.lines[0].operationKey, variantId: 301,
      orderId: 101, delta: 3, reason: InventoryReason.RETURN_RECEIVED,
      refType: 'RETURN_RECEIPT_ITEM', refId: 601, createdBy: 9 };
    expect(f.find).toHaveBeenCalledWith(f.tx, input);
    expect(f.append).toHaveBeenCalledTimes(1);
    expect(f.append).toHaveBeenCalledWith(f.tx, input, 6);
  });
  it('RA-04: confirms new effect with source document and observation time', async () => {
    const f = fixture(); await apply(f);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(f.tx, { operationKey: f.receipt.lines[0].operationKey,
      variantId: 301, expectedVersion: 1, sourceDocumentId: 'KV-RETURN-15', acknowledgedAt: OBSERVED_AT });
  });
  it('RA-05: checks identity then updates stock then appends and confirms', async () => {
    const f = fixture(); await apply(f);
    const sequence = [f.find, f.mock.inventory.updateMany, f.append, f.release]
      .map(fn => fn.mock.invocationCallOrder[0]);
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
    expect(new Set(sequence).size).toBe(4);
  });
  it('RA-06: retains unreflected negative effects without releasing them', async () => {
    const f = fixture(); effectFixture(f); f.inventory.quantity = 8;
    await apply(f);
    expect(f.mock.inventory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 11, sourceQuantity: 13, syncStatus: SyncState.PENDING }),
    }));
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release.mock.calls[0][1].operationKey).toBe(f.receipt.lines[0].operationKey);
  });
  it('RA-07: releases previously confirmed effect before stock write', async () => {
    const f = fixture(); effectFixture(f, true);
    await apply(f);
    expect(f.release).toHaveBeenCalledTimes(2);
    expect(f.release).toHaveBeenNthCalledWith(1, f.tx, { operationKey: 'ORDER-201-DEDUCT',
      variantId: 301, expectedVersion: 1, sourceDocumentId: 'KV-ORDER-201', acknowledgedAt: OBSERVED_AT });
    expect(f.release.mock.invocationCallOrder[0]).toBeLessThan(f.mock.inventory.updateMany.mock.invocationCallOrder[0]);
    expect(f.release.mock.calls[1][1].operationKey).toBe(f.receipt.lines[0].operationKey);
  });
  it('RA-08: updates one SKU once for multiple receipt lines', async () => {
    const f = fixture(); secondLine(f);
    const results = await apply(f);
    expect(results.map(r => r.delta)).toEqual([3, 2]);
    expect(results.map(r => r.inventoryVersion)).toEqual([6, 6]);
    expect(f.mock.inventory.updateMany).toHaveBeenCalledTimes(1);
    expect(f.mock.inventory.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 15 }) }));
    expect(f.append).toHaveBeenCalledTimes(2);
    expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('RA-09: skips a non-resalable line in a mixed receipt', async () => {
    const f = fixture(); secondLine(f, false, 0);
    expect(await apply(f)).toHaveLength(1);
    expect(f.append).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('RA-10: uses delivery return reference and nullable actor', async () => {
    const f = fixture(); f.receipt.receiptKind = 'DELIVERY_RETURN';
    f.evidence.receiptKind = 'DELIVERY_RETURN'; f.receipt.actorId = null;
    const line = f.receipt.lines[0]; line.requestItemId = null; line.acceptedQuantity = null;
    line.operationKey = 'M03-DELIVERY-RETURN-ITEM-601-RESTOCK';
    expect(await apply(f)).toEqual([expect.objectContaining({ receiptKind: 'DELIVERY_RETURN', receiptItemId: 601, replayed: false })]);
    expect(f.append).toHaveBeenCalledWith(f.tx, expect.objectContaining({ operationKey: line.operationKey,
      refType: 'DELIVERY_RETURN_ITEM', refId: 601, createdBy: null, delta: 3 }), 6);
  });
  it('RA-11: processes two SKUs in ascending order', async () => {
    const f = fixture(); secondLine(f, true);
    expect((await apply(f)).map(r => r.variantId)).toEqual([301, 302]);
    expect(f.mock.inventory.updateMany.mock.calls.map(c => c[0].where.variantId)).toEqual([301, 302]);
    expect(f.append).toHaveBeenCalledTimes(2);
    expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('RA-12: rejects extra unexplained positive source stock before writes', async () => {
    const f = fixture(); f.snapshot.sourceQuantity = 14;
    await rejectApply(f); expectNoWrites(f);
  });
  it('RA-13: rejects unexplained lower source stock before writes', async () => {
    const f = fixture(); f.snapshot.sourceQuantity = 12;
    await rejectApply(f); expectNoWrites(f);
  });
  it('RA-14: validates all SKU net changes before any writes', async () => {
    const f = fixture(); secondLine(f, true); f.evidence.snapshots[0].sourceQuantity = 13;
    await rejectApply(f); expectNoWrites(f);
  });
  it('RA-15: stops when optimistic update affects no row', async () => {
    const f = fixture(); f.mock.inventory.updateMany.mockResolvedValue({ count: 0 });
    await rejectApply(f, 'VERSION_CONFLICT');
    expect(f.mock.inventory.updateMany).toHaveBeenCalledTimes(1);
    expect(f.append).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  });
  it('RA-16: rejects unexpected update count greater than one', async () => {
    const f = fixture(); f.mock.inventory.updateMany.mockResolvedValue({ count: 2 });
    await rejectApply(f, 'VERSION_CONFLICT');
    expect(f.append).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  });
  it('RA-17: stops if old confirmed effect is unexpectedly replayed', async () => {
    const f = fixture(); effectFixture(f, true); f.release.mockResolvedValueOnce(releaseResult(f, true));
    await rejectApply(f);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.mock.inventory.updateMany).not.toHaveBeenCalled(); expect(f.append).not.toHaveBeenCalled();
  });
  it('RA-18: rejects unexpected replay of new effect', async () => {
    const f = fixture(); f.release.mockResolvedValueOnce(releaseResult(f, true));
    await rejectApply(f); expect(f.append).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('RA-19: rejects new effect not confirmed', async () => {
    const f = fixture(); f.release.mockResolvedValueOnce(releaseResult(f, false, SyncState.PENDING));
    await rejectApply(f); expect(f.append).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('RA-20: propagates append failure to caller and does not confirm', async () => {
    const f = fixture(); const error = new Error('append failed'); f.append.mockRejectedValueOnce(error);
    await expect(apply(f)).rejects.toBe(error);
    expect(f.mock.inventory.updateMany).toHaveBeenCalledTimes(1); expect(f.release).not.toHaveBeenCalled();
  });
  it('RA-21: propagates confirmation failure and stops later SKUs', async () => {
    const f = fixture(); secondLine(f, true); const error = new Error('release failed'); f.release.mockRejectedValueOnce(error);
    await expect(apply(f)).rejects.toBe(error);
    expect(f.mock.inventory.updateMany).toHaveBeenCalledTimes(1); expect(f.append).toHaveBeenCalledTimes(1);
  });
  it('RA-22: rejects recorded operation detected immediately before write', async () => {
    const f = fixture(); f.find.mockResolvedValueOnce({ operationKey: f.receipt.lines[0].operationKey,
      variantId: 301, movementId: '601', pendingEffectId: '1', inventoryVersion: 6, delta: 3 });
    await rejectApply(f); expectNoWrites(f);
  });
});
