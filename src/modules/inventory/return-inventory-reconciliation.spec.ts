import { HttpException } from '@nestjs/common';
import { SyncState } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { InventoryLedgerService } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { ReturnInventoryService } from './return-inventory.service';
import type { PreparedReturnReceipt } from './return-inventory.service';
import type { VerifiedReturnEvidence } from './return-inventory.contract';

const MAX_INT = 2147483647;
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
    inventory: { findUniqueOrThrow: jest.fn().mockResolvedValue(inventory), updateMany: jest.fn() },
    returnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    deliveryReturnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    inventoryMovement: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
    pendingInventoryEffect: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
  };
  const ledger = new InventoryLedgerService();
  const pending = new PendingInventoryEffectService();
  const append = jest.spyOn(ledger, 'appendPendingMovement');
  const release = jest.spyOn(pending, 'releaseConfirmed');
  const service = new ReturnInventoryService(ledger, pending);
  const prepare = jest.spyOn(service, 'prepareReceipt').mockResolvedValue(receipt);
  const tx = mock as unknown as Prisma.TransactionClient;
  return { receipt, evidence, snapshot: evidence.snapshots[0], inventory, mock, service, tx, prepare, append, release };
}

type Fixture = ReturnType<typeof fixture>;

function effectFixture(f: Fixture, confirmed = false, delta = -2) {
  const effect = {
    operationKey: 'ORDER-201-DEDUCT', variantId: 301, delta, version: 1,
    status: SyncState.PENDING as SyncState, releasedAt: null as Date | null,
    sourceDocumentId: null as string | null, sourceAcknowledgedAt: null as Date | null,
  };
  const movement = { operationKey: effect.operationKey, variantId: 301, delta, sourceDocumentId: null as string | null };
  f.mock.pendingInventoryEffect.findMany.mockResolvedValue([effect]);
  f.mock.inventoryMovement.findMany.mockResolvedValue([movement]);
  if (confirmed) {
    f.snapshot.confirmedEffects.push({ operationKey: effect.operationKey, expectedVersion: 1, sourceDocumentId: 'KV-ORDER-201' });
  } else {
    f.snapshot.notReflectedEffects.push({ operationKey: effect.operationKey, expectedVersion: 1 });
  }
  return { effect, movement };
}

function plan(f: Fixture) {
  return f.service.prepareSourceReconciliation(f.tx, 'CUSTOMER_RETURN', 15, f.evidence);
}

function expectNoWrites(f: Fixture): void {
  expect(f.mock.inventory.updateMany).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.create).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.updateMany).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.create).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.updateMany).not.toHaveBeenCalled();
  expect(f.append).not.toHaveBeenCalled();
  expect(f.release).not.toHaveBeenCalled();
}

async function rejectPlan(f: Fixture, status = 409, code = 'CONFLICT', message?: string): Promise<void> {
  try {
    await plan(f);
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
    if (message !== undefined) expect(error.getResponse()).toMatchObject({ message });
    expectNoWrites(f);
    return;
  }
  throw new Error(`Expected ${code} was not thrown`);
}

describe('ReturnInventoryService - source reconciliation preparation', () => {
  it('SR-01: projects source stock without adding return twice', async () => {
    const f = fixture();
    const result = await plan(f);
    expect(f.prepare).toHaveBeenCalledWith(f.tx, 'CUSTOMER_RETURN', 15);
    expect(result.receipt).toEqual(f.receipt);
    expect(result.plans).toEqual([{ variantId: 301, inventoryVersion: 5, previousQuantity: 10, projectedQuantity: 13, projectedSyncStatus: SyncState.CONFIRMED, pendingDelta: '0', snapshot: f.snapshot }]);
    expectNoWrites(f);
  });
  it('SR-02: subtracts only unreflected negative effects', async () => {
    const f = fixture(); effectFixture(f);
    expect((await plan(f)).plans[0]).toMatchObject({ projectedQuantity: 11, pendingDelta: '-2', projectedSyncStatus: SyncState.PENDING });
    expectNoWrites(f);
  });
  it('SR-03: excludes confirmed effects from pending delta', async () => {
    const f = fixture(); effectFixture(f, true);
    expect((await plan(f)).plans[0]).toMatchObject({ projectedQuantity: 13, pendingDelta: '0', projectedSyncStatus: SyncState.CONFIRMED });
    expectNoWrites(f);
  });
  it('SR-04: includes positive unreflected effect', async () => {
    const f = fixture(); effectFixture(f, false, 2);
    expect((await plan(f)).plans[0]).toMatchObject({ projectedQuantity: 15, pendingDelta: '2', projectedSyncStatus: SyncState.PENDING });
    expectNoWrites(f);
  });
  it('SR-05: clamps negative calculated stock to zero', async () => {
    const f = fixture(); effectFixture(f, false, -15);
    expect((await plan(f)).plans[0]).toMatchObject({ projectedQuantity: 0, pendingDelta: '-15', projectedSyncStatus: SyncState.NEEDS_RECONCILIATION });
    expectNoWrites(f);
  });
  it('SR-06: preserves unresolved reconciliation status', async () => {
    const f = fixture(); const { effect } = effectFixture(f);
    effect.status = SyncState.NEEDS_RECONCILIATION;
    expect((await plan(f)).plans[0]).toMatchObject({ projectedQuantity: 11, projectedSyncStatus: SyncState.NEEDS_RECONCILIATION });
    expectNoWrites(f);
  });
  it('SR-07: locks variants then inventories in ascending SKU order', async () => {
    const f = fixture();
    f.receipt.lines.push({ ...f.receipt.lines[0], receiptItemId: 602, orderItemId: 202, requestItemId: 402, variantId: 302, operationKey: 'M03-RETURN-RECEIPT-ITEM-602-RESTOCK' });
    f.evidence.snapshots.unshift({ ...f.snapshot, variantId: 302, sourceVariantId: 'KV-SKU-302' });
    f.mock.productVariant.findUniqueOrThrow.mockImplementation(async (args: { where: { id: number } }) => ({ kiotvietVariantId: `KV-SKU-${args.where.id}` }));
    const result = await plan(f);
    expect(result.plans.map(p => p.variantId)).toEqual([301, 302]);
    expect(f.evidence.snapshots.map(s => s.variantId)).toEqual([302, 301]);
    const queries = f.mock.$queryRaw.mock.calls.map(call => (call[0] as TemplateStringsArray).join('?'));
    expect(queries).toHaveLength(4);
    expect(queries[0]).toMatch(/FROM product_variants\s+WHERE id = \? FOR UPDATE/);
    expect(queries[1]).toMatch(/FROM inventories\s+WHERE variantId = \? FOR UPDATE/);
    expect(queries[2]).toEqual(queries[0]);
    expect(queries[3]).toEqual(queries[1]);
    expect(f.mock.$queryRaw.mock.calls.map(call => call[1])).toEqual([301, 301, 302, 302]);
    expectNoWrites(f);
  });
  it('SR-08: rejects missing variant', async () => {
    const f = fixture(); f.mock.$queryRaw.mockResolvedValueOnce([]);
    await rejectPlan(f, 404, 'NOT_FOUND');
  });
  it('SR-09: rejects incorrect source mapping', async () => {
    const f = fixture(); f.mock.productVariant.findUniqueOrThrow.mockResolvedValue({ kiotvietVariantId: 'OTHER' });
    await rejectPlan(f);
  });
  it('SR-10: rejects missing source mapping', async () => {
    const f = fixture(); f.mock.productVariant.findUniqueOrThrow.mockResolvedValue({ kiotvietVariantId: null });
    await rejectPlan(f);
  });
  it('SR-11: rejects missing inventory', async () => {
    const f = fixture(); f.mock.$queryRaw.mockResolvedValueOnce([{ id: 301 }]).mockResolvedValueOnce([]);
    await rejectPlan(f, 404, 'NOT_FOUND');
  });
  it('SR-12: rejects stale inventory version', async () => {
    const f = fixture(); f.inventory.version = 6;
    await rejectPlan(f, 409, 'VERSION_CONFLICT');
  });
  it('SR-13: rejects exhausted inventory version', async () => {
    const f = fixture(); f.inventory.version = MAX_INT; f.snapshot.expectedInventoryVersion = MAX_INT;
    await rejectPlan(f);
  });
  it('SR-14: rejects invalid inventory quantity', async () => {
    const f = fixture(); f.inventory.quantity = -1;
    await rejectPlan(f);
  });
  it('SR-15: rejects observation equal to last confirmation', async () => {
    const f = fixture(); f.inventory.lastConfirmedAt = new Date(OBSERVED_AT);
    await rejectPlan(f);
  });
  it('SR-16: rejects observation older than last confirmation', async () => {
    const f = fixture(); f.inventory.lastConfirmedAt = new Date('2020-01-04T00:00:00.000Z');
    await rejectPlan(f);
  });
  it('SR-17: rejects repeated source version', async () => {
    const f = fixture(); f.inventory.sourceVersion = f.snapshot.sourceVersion;
    await rejectPlan(f);
  });
  it('SR-18: rejects missing effect classification', async () => {
    const f = fixture(); effectFixture(f); f.snapshot.notReflectedEffects = [];
    await rejectPlan(f);
  });
  it('SR-19: rejects extra effect classification', async () => {
    const f = fixture(); f.snapshot.notReflectedEffects.push({ operationKey: 'UNKNOWN', expectedVersion: 1 });
    await rejectPlan(f);
  });
  it('SR-20: rejects wrong effect key even if counts match', async () => {
    const f = fixture(); effectFixture(f); f.snapshot.notReflectedEffects[0].operationKey = 'OTHER';
    await rejectPlan(f);
  });
  it('SR-21: rejects stale pending effect version', async () => {
    const f = fixture(); const { effect } = effectFixture(f); effect.version = 2;
    await rejectPlan(f, 409, 'VERSION_CONFLICT');
  });
  it('SR-22: rejects missing movement', async () => {
    const f = fixture(); effectFixture(f); f.mock.inventoryMovement.findMany.mockResolvedValue([]);
    await rejectPlan(f);
  });
  it('SR-23: rejects movement delta mismatch', async () => {
    const f = fixture(); const { movement } = effectFixture(f); movement.delta = -3;
    await rejectPlan(f);
  });
  it('SR-24: rejects movement variant mismatch', async () => {
    const f = fixture(); const { movement } = effectFixture(f); movement.variantId = 999;
    await rejectPlan(f);
  });
  it('SR-25: rejects movement source document mismatch', async () => {
    const f = fixture(); const { movement } = effectFixture(f); movement.sourceDocumentId = 'OTHER';
    await rejectPlan(f);
  });
  it('SR-26: rejects released effect in unresolved set', async () => {
    const f = fixture(); const { effect } = effectFixture(f); effect.releasedAt = new Date(OBSERVED_AT);
    await rejectPlan(f);
  });
  it('SR-27: rejects confirmed effect without release timestamp', async () => {
    const f = fixture(); const { effect } = effectFixture(f); effect.status = SyncState.CONFIRMED;
    await rejectPlan(f);
  });
  it('SR-28: rejects zero effect delta', async () => {
    const f = fixture(); effectFixture(f, false, 0);
    await rejectPlan(f);
  });
  it('SR-29: rejects conflicting confirmed source document', async () => {
    const f = fixture(); const { effect, movement } = effectFixture(f, true);
    effect.sourceDocumentId = 'OTHER'; movement.sourceDocumentId = 'OTHER';
    await rejectPlan(f);
  });
  it('SR-30: rejects acknowledged effect classified as unreflected', async () => {
    const f = fixture(); const { effect } = effectFixture(f); effect.sourceAcknowledgedAt = new Date(OBSERVED_AT);
    await rejectPlan(f);
  });
  it('SR-31: rejects projected quantity overflow', async () => {
    const f = fixture(); effectFixture(f, false, 1); f.snapshot.sourceQuantity = MAX_INT;
    await rejectPlan(f);
  });
  it('SR-32: rejects source document owned by another customer receipt', async () => {
    const f = fixture(); f.mock.returnReceipt.findFirst.mockResolvedValue({ id: 16 });
    await rejectPlan(f);
    expect(f.mock.returnReceipt.findFirst).toHaveBeenCalledWith({ where: { kiotDocumentId: 'KV-RETURN-15', id: { not: 15 } }, select: { id: true } });
  });
  it('SR-33: rejects source document owned by delivery receipt', async () => {
    const f = fixture(); f.mock.deliveryReturnReceipt.findFirst.mockResolvedValue({ id: 16 });
    await rejectPlan(f);
    expect(f.mock.deliveryReturnReceipt.findFirst).toHaveBeenCalledWith({ where: { kiotDocumentId: 'KV-RETURN-15' }, select: { id: true } });
  });
  it('SR-34: rejects existing return movement in new-only preparation', async () => {
    const f = fixture(); f.mock.inventoryMovement.findFirst.mockResolvedValue({ id: 1 });
    await rejectPlan(f);
  });
  it('SR-35: rejects existing return effect in new-only preparation', async () => {
    const f = fixture(); f.mock.pendingInventoryEffect.findFirst.mockResolvedValue({ id: 1 });
    await rejectPlan(f);
  });
  it('SR-36: checks unresolved effects even if status is inconsistent', async () => {
    const f = fixture(); await plan(f);
    expect(f.mock.pendingInventoryEffect.findMany).toHaveBeenCalledWith({ where: { variantId: 301, OR: [{ releasedAt: null }, { status: { not: SyncState.CONFIRMED } }] } });
    expectNoWrites(f);
  });
});
