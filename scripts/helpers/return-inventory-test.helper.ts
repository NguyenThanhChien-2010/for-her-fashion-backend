import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InventoryReason, Prisma, SyncState } from '@prisma/client';
import type { VerifiedReturnEvidence } from '../../src/modules/inventory/return-inventory.contract';

// Shared checks for the historical IT-R01–R07 fixtures only.
// Do not use these fixtures on an already-advanced database baseline.
const database = 'for_her_fashion_m03_test';
const manifestHash = '0274b795e885692f02cd011798939dd66a7ac9204e0e5eb59bf9431e466a6f35';
export const runTag = 'ff7ceb8f';

export const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10000,
  timeout: 30000,
};

export type JsonEvidence = Omit<VerifiedReturnEvidence, 'snapshots'> & {
  snapshots: Array<Omit<VerifiedReturnEvidence['snapshots'][number], 'observedAt'> & { observedAt: string }>;
};

export function readFixture<T extends { caseId: string }>(caseId: string, actorId: number, hashMessage?: string): T {
  const path = process.env.M03_RETURN_MANIFEST_PATH;
  assert.ok(path, 'Missing manifest path');
  const raw = readFileSync(path);
  assert.equal(createHash('sha256').update(raw).digest('hex'), manifestHash, hashMessage);
  const manifest = JSON.parse(raw.toString('utf8')) as {
    runTag: string; customerId: number; actorId: number; fixtures: T[];
  };
  assert.equal(manifest.runTag, runTag);
  assert.equal(manifest.customerId, 4);
  assert.equal(manifest.actorId, actorId);
  assert.equal(manifest.fixtures.length, 7);
  const fixture = manifest.fixtures.find(item => item.caseId === caseId);
  assert.ok(fixture);
  return fixture;
}

export function restoreEvidence(raw: JsonEvidence): VerifiedReturnEvidence {
  const evidence: VerifiedReturnEvidence = {
    ...raw,
    snapshots: raw.snapshots.map(snapshot => ({
      ...snapshot, observedAt: new Date(snapshot.observedAt),
    })),
  };
  return evidence;
}

export async function verifyTarget(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ databaseName: string; serverHost: string }>>`
    SELECT DATABASE() AS databaseName, @@hostname AS serverHost
  `;
  assert.equal(rows[0]?.databaseName, database);
  assert.ok(process.env.M03_EXPECTED_HOST);
  assert.equal(rows[0]?.serverHost, process.env.M03_EXPECTED_HOST);
}

export async function capture(tx: Prisma.TransactionClient) {
  return {
    inventory: await tx.inventory.findMany({ orderBy: { variantId: 'asc' } }),
    movements: await tx.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    effects: await tx.pendingInventoryEffect.findMany({ orderBy: { id: 'asc' } }),
    orders: await tx.order.findMany({ orderBy: { id: 'asc' } }),
    orderItems: await tx.orderItem.findMany({ orderBy: { id: 'asc' } }),
    requests: await tx.returnRequest.findMany({ orderBy: { id: 'asc' } }),
    requestItems: await tx.returnRequestItem.findMany({ orderBy: { id: 'asc' } }),
    receipts: await tx.returnReceipt.findMany({ orderBy: { id: 'asc' } }),
    receiptItems: await tx.returnReceiptItem.findMany({ orderBy: { id: 'asc' } }),
    deliveryReceipts: await tx.deliveryReturnReceipt.findMany({ orderBy: { id: 'asc' } }),
    deliveryItems: await tx.deliveryReturnItem.findMany({ orderBy: { id: 'asc' } }),
  };
}

export type State = Awaited<ReturnType<typeof capture>>;

interface ConfirmedReturnExpectation {
  variantId: number;
  orderId: number;
  key: string;
  doc: string;
  actorId: number | null;
  quantity: number;
  delta: number;
  refType: 'RETURN_RECEIPT_ITEM' | 'DELIVERY_RETURN_ITEM';
  refId: number;
}

export function verifyConfirmedReturn(before: State, after: State, evidence: VerifiedReturnEvidence, expected: ConfirmedReturnExpectation) {
  const { variantId, orderId, key, doc, actorId, quantity, delta, refType, refId } = expected;
  const snapshot = evidence.snapshots[0];
  const stock = after.inventory.find(row => row.variantId === variantId);
  assert.ok(stock);
  assert.equal(stock.quantity, quantity);
  assert.equal(stock.version, 4);
  assert.equal(stock.sourceQuantity, quantity);
  assert.equal(stock.sourceVersion, snapshot.sourceVersion);
  assert.deepEqual(stock.lastConfirmedAt, snapshot.observedAt);
  assert.equal(stock.syncStatus, SyncState.CONFIRMED);
  assert.deepEqual(after.inventory.filter(row => row.variantId !== variantId), before.inventory.filter(row => row.variantId !== variantId));
  assert.equal(after.movements.length, before.movements.length + 1);
  assert.equal(after.effects.length, before.effects.length + 1);
  assert.deepEqual(after.movements.filter(row => row.operationKey !== key), before.movements);
  assert.deepEqual(after.effects.filter(row => row.operationKey !== key), before.effects);
  const movement = after.movements.find(row => row.operationKey === key);
  const effect = after.effects.find(row => row.operationKey === key);
  assert.ok(movement && effect);
  assert.equal(movement.variantId, variantId);
  assert.equal(movement.delta, delta);
  assert.equal(movement.inventoryVersion, 4);
  assert.equal(movement.reason, InventoryReason.RETURN_RECEIVED);
  assert.equal(movement.refType, refType);
  assert.equal(movement.refId, refId);
  assert.equal(movement.createdBy, actorId);
  assert.equal(movement.sourceDocumentId, doc);
  assert.equal(effect.variantId, variantId);
  assert.equal(effect.orderId, orderId);
  assert.equal(effect.delta, delta);
  assert.equal(effect.version, 2);
  assert.equal(effect.status, SyncState.CONFIRMED);
  assert.equal(effect.sourceDocumentId, doc);
  assert.deepEqual(effect.sourceAcknowledgedAt, snapshot.observedAt);
  assert.ok(effect.releasedAt instanceof Date);
  assert.ok(effect.releasedAt.getTime() >= snapshot.observedAt.getTime());
  assert.deepEqual(after.orders, before.orders);
  assert.deepEqual(after.orderItems, before.orderItems);
  assert.deepEqual(after.requests, before.requests);
  assert.deepEqual(after.requestItems, before.requestItems);
  assert.deepEqual(after.receipts, before.receipts);
  assert.deepEqual(after.receiptItems, before.receiptItems);
  assert.deepEqual(after.deliveryReceipts, before.deliveryReceipts);
  assert.deepEqual(after.deliveryItems, before.deliveryItems);
  return { stock, movement, effect };
}

interface PriorReturn {
  variantId: number;
  quantity: number;
  delta: number;
  id: string;
  key: string;
}

export function verifyPriorReturns(before: State, priors: readonly PriorReturn[]) {
  for (const prior of priors) {
    const inventory = before.inventory.find(row => row.variantId === prior.variantId);
    const movement = before.movements.find(row => row.operationKey === prior.key);
    const effect = before.effects.find(row => row.operationKey === prior.key);
    assert.ok(inventory && movement && effect);
    assert.equal(inventory.quantity, prior.quantity);
    assert.equal(inventory.version, 4);
    assert.equal(inventory.sourceQuantity, prior.quantity);
    assert.equal(inventory.syncStatus, SyncState.CONFIRMED);
    assert.equal(String(movement.id), prior.id);
    assert.equal(movement.delta, prior.delta);
    assert.equal(movement.reason, InventoryReason.RETURN_RECEIVED);
    assert.equal(String(effect.id), prior.id);
    assert.equal(effect.delta, prior.delta);
    assert.equal(effect.status, SyncState.CONFIRMED);
    assert.equal(effect.version, 2);
  }
}
