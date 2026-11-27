import 'reflect-metadata';

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpException } from '@nestjs/common';
import { InventoryReason, Prisma, SyncState } from '@prisma/client';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { InventoryLedgerService } from '../src/modules/inventory/inventory-ledger.service';
import { PendingInventoryEffectService } from '../src/modules/inventory/pending-inventory-effect.service';
import { ReturnInventoryService } from '../src/modules/inventory/return-inventory.service';
import type { PreparedReturnLine } from '../src/modules/inventory/return-inventory.service';
import type { VerifiedReturnEvidence } from '../src/modules/inventory/return-inventory.contract';

const database = 'for_her_fashion_m03_test';
const manifestHash = '0274b795e885692f02cd011798939dd66a7ac9204e0e5eb59bf9431e466a6f35';
const runTag = 'ff7ceb8f';
const orderId = 11;
const receiptId = 6;
const variantId = 11;
const pendingOrderId = 12;
const pendingKey = 'M03-ORDER-12-SKU-11-DEDUCT';
const actorId = 5;
const key = 'M03-RETURN-RECEIPT-ITEM-7-RESTOCK';
const doc = 'M03R-ff7ceb8f-07-RETURN';
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10000,
  timeout: 30000,
};

type JsonEvidence = Omit<VerifiedReturnEvidence, 'snapshots'> & {
  snapshots: Array<Omit<VerifiedReturnEvidence['snapshots'][number], 'observedAt'> & { observedAt: string }>;
};
interface Fixture {
  caseId: string;
  kind: string;
  orderId: number;
  requestId: number;
  pendingOrderId: number;
  baseline: unknown[];
  receiptId: number;
  receivedAt: string;
  evidence: JsonEvidence;
  lines: PreparedReturnLine[];
}

function readEvidence(): VerifiedReturnEvidence {
  const path = process.env.M03_RETURN_MANIFEST_PATH;
  assert.ok(path, 'Missing manifest path');
  const raw = readFileSync(path);
  assert.equal(createHash('sha256').update(raw).digest('hex'), manifestHash, 'Manifest SHA256 mismatch');
  const manifest = JSON.parse(raw.toString('utf8')) as {
    runTag: string; customerId: number; actorId: number; fixtures: Fixture[];
  };
  assert.equal(manifest.runTag, runTag);
  assert.equal(manifest.customerId, 4);
  assert.equal(manifest.actorId, actorId);
  assert.equal(manifest.fixtures.length, 7);
  const fixture = manifest.fixtures.find(item => item.caseId === 'IT-R07');
  assert.ok(fixture);
  assert.equal(fixture.kind, 'CUSTOMER_RETURN');
  assert.equal(fixture.orderId, orderId);
  assert.equal(fixture.requestId, 6);
  assert.equal(fixture.pendingOrderId, pendingOrderId);
  assert.deepEqual(fixture.baseline, [{ variantId, quantity: 8, version: 4, sourceQuantity: 10, syncStatus: SyncState.PENDING, expectedAfter: 10 }]);
  assert.equal(fixture.receiptId, receiptId);
  assert.equal(fixture.lines.length, 1);
  assert.deepEqual(fixture.lines[0], {
    receiptItemId: 7, orderItemId: 13, requestItemId: 7, variantId,
    orderedQuantity: 5, receivedQuantity: 4, acceptedQuantity: 3,
    resalableQuantity: 2, operationKey: key,
  });
  const evidence: VerifiedReturnEvidence = {
    ...fixture.evidence,
    snapshots: fixture.evidence.snapshots.map(snapshot => ({
      ...snapshot, observedAt: new Date(snapshot.observedAt),
    })),
  };
  assert.equal(evidence.receiptKind, 'CUSTOMER_RETURN');
  assert.equal(evidence.receiptId, receiptId);
  assert.equal(evidence.sourceDocumentId, doc);
  assert.equal(evidence.snapshots.length, 1);
  assert.deepEqual(evidence.snapshots[0], {
    variantId, sourceVariantId: 'M03R-ff7ceb8f-07-1-KV',
    expectedInventoryVersion: 4, restockedQuantity: 2,
    sourceQuantity: 12, sourceVersion: 'M03R-ff7ceb8f-07-1-RETURN',
    observedAt: new Date(fixture.receivedAt), confirmedEffects: [], notReflectedEffects: [{ operationKey: pendingKey, expectedVersion: 1 }],
  });
  assert.ok(Number.isFinite(evidence.snapshots[0].observedAt.getTime()));
  console.log('Manifest identity, SHA256 and Date restoration PASS');
  return evidence;
}

async function verifyTarget(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ databaseName: string; serverHost: string }>>`
    SELECT DATABASE() AS databaseName, @@hostname AS serverHost
  `;
  assert.equal(rows[0]?.databaseName, database);
  assert.ok(process.env.M03_EXPECTED_HOST);
  assert.equal(rows[0]?.serverHost, process.env.M03_EXPECTED_HOST);
}

async function capture(tx: Prisma.TransactionClient) {
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

type State = Awaited<ReturnType<typeof capture>>;

function verifyBefore(before: State) {
  assert.equal(before.inventory.length, 11);
  assert.equal(before.movements.length, 14);
  assert.equal(before.effects.length, 14);
  assert.equal(before.orders.length, 9);
  assert.equal(before.orderItems.length, 10);
  assert.equal(before.receipts.length, 6);
  assert.equal(before.receiptItems.length, 7);
  assert.equal(before.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length, 4);
  // Preserve the four already accepted returns, including their ledger IDs.
  for (const prior of [
    { variantId: 4, quantity: 12, delta: 2, id: '12', key: 'M03-RETURN-RECEIPT-ITEM-1-RESTOCK' },
    { variantId: 5, quantity: 13, delta: 3, id: '13', key: 'M03-DELIVERY-RETURN-ITEM-1-RESTOCK' },
    { variantId: 6, quantity: 12, delta: 2, id: '14', key: 'M03-RETURN-RECEIPT-ITEM-2-RESTOCK' },
    { variantId: 7, quantity: 12, delta: 2, id: '15', key: 'M03-RETURN-RECEIPT-ITEM-3-RESTOCK' },
  ]) {
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
  console.log('IT-R01 through IT-R04 committed baselines PASS');
  assert.equal(before.requests.length, 6);
  assert.equal(before.requestItems.length, 7);
  assert.equal(before.deliveryReceipts.length, 1);
  assert.equal(before.deliveryItems.length, 1);
  for (const id of [8, 9, 10]) {
    const stock = before.inventory.find(row => row.variantId === id);
    assert.ok(stock);
    assert.equal(stock.quantity, 10);
    assert.equal(stock.version, 3);
    assert.equal(stock.sourceQuantity, 10);
    assert.equal(stock.syncStatus, SyncState.CONFIRMED);
  }
  for (const operationKey of [key, ...[4, 5, 6].map(id => `M03-RETURN-RECEIPT-ITEM-${id}-RESTOCK`)]) {
    assert.equal(before.movements.some(row => row.operationKey === operationKey), false);
    assert.equal(before.effects.some(row => row.operationKey === operationKey), false);
  }
  const noStockReceipt = before.receipts.find(row => row.id === 5);
  const noStockLine = before.receiptItems.find(row => row.id === 6);
  assert.ok(noStockReceipt && noStockLine);
  assert.equal(noStockReceipt.kiotDocumentId, null);
  assert.equal(noStockLine.resalableQuantity, 0);
  console.log('IT-R05 rollback and IT-R06 no-stock baselines PASS');
  const stock = before.inventory.find(row => row.variantId === variantId);
  assert.ok(stock);
  assert.equal(stock.quantity, 8);
  assert.equal(stock.version, 4);
  assert.equal(stock.sourceQuantity, 10);
  assert.equal(stock.sourceVersion, 'M03R-ff7ceb8f-07-1-SALE');
  assert.equal(stock.syncStatus, SyncState.PENDING);
  const order = before.orders.find(row => row.id === orderId);
  assert.ok(order);
  assert.equal(order.userId, 4);
  assert.equal(order.status, 'DELIVERED');
  const receipt = before.receipts.find(row => row.id === receiptId);
  assert.ok(receipt);
  assert.equal(receipt.requestId, 6);
  assert.equal(receipt.actorId, actorId);
  assert.equal(receipt.kiotDocumentId, doc);
  const line = before.receiptItems.find(row => row.id === 7);
  assert.ok(line);
  assert.equal(line.receiptId, receiptId);
  assert.equal(line.requestItemId, 7);
  assert.equal(line.receivedQuantity, 4);
  assert.equal(line.acceptedQuantity, 3);
  assert.equal(line.resalableQuantity, 2);
  const saleKey = `M03-ORDER-${orderId}-SKU-${variantId}-DEDUCT`;
  const sale = before.movements.find(row => row.operationKey === saleKey);
  const saleEffect = before.effects.find(row => row.operationKey === saleKey);
  assert.ok(sale && saleEffect);
  assert.equal(sale.reason, InventoryReason.ORDER_CREATED);
  assert.equal(sale.variantId, variantId);
  assert.equal(sale.delta, -5);
  assert.equal(saleEffect.orderId, orderId);
  assert.equal(saleEffect.delta, -5);
  assert.equal(saleEffect.status, SyncState.CONFIRMED);
  assert.ok(saleEffect.releasedAt);
  const pendingOrder = before.orders.find(row => row.id === pendingOrderId);
  assert.ok(pendingOrder);
  assert.equal(pendingOrder.userId, 4);
  const pendingItems = before.orderItems.filter(row => row.orderId === pendingOrderId);
  assert.equal(pendingItems.length, 1);
  assert.equal(pendingItems[0].variantId, variantId);
  assert.equal(pendingItems[0].quantity, 2);
  verifyPending(before, 10, 8);
  console.log('IT-R07 initial stock, original deduction and outstanding pending effect PASS');
}

function verifyPending(state: State, source: number, quantity: number) {
  const openEffects = state.effects.filter(row => row.variantId === variantId && row.releasedAt === null);
  assert.equal(openEffects.length, 1);
  const pending = openEffects[0];
  assert.equal(pending.operationKey, pendingKey);
  assert.equal(pending.orderId, pendingOrderId);
  assert.equal(pending.delta, -2);
  assert.equal(pending.version, 1);
  assert.equal(pending.status, SyncState.PENDING);
  assert.equal(pending.sourceDocumentId, null);
  assert.equal(pending.sourceAcknowledgedAt, null);
  const movement = state.movements.find(row => row.operationKey === pendingKey);
  assert.ok(movement);
  assert.equal(movement.variantId, variantId);
  assert.equal(movement.delta, -2);
  assert.equal(movement.inventoryVersion, 4);
  assert.equal(movement.reason, InventoryReason.ORDER_CREATED);
  assert.equal(movement.sourceDocumentId, null);
  const sum = openEffects.reduce((total, row) => total + row.delta, 0);
  assert.equal(sum, -2);
  assert.equal(source + sum, quantity);
  return pending;
}

function verifyAfter(before: State, after: State, evidence: VerifiedReturnEvidence) {
  const snapshot = evidence.snapshots[0];
  const stock = after.inventory.find(row => row.variantId === variantId);
  assert.ok(stock);
  assert.equal(stock.quantity, 10);
  assert.equal(stock.version, 5);
  assert.equal(stock.sourceQuantity, 12);
  assert.equal(stock.sourceVersion, snapshot.sourceVersion);
  assert.deepEqual(stock.lastConfirmedAt, snapshot.observedAt);
  assert.equal(stock.syncStatus, SyncState.PENDING);
  const pending = verifyPending(after, 12, 10);
  assert.deepEqual(pending, verifyPending(before, 10, 8));
  assert.deepEqual(after.inventory.filter(row => row.variantId !== variantId), before.inventory.filter(row => row.variantId !== variantId));
  assert.equal(after.movements.length, before.movements.length + 1);
  assert.equal(after.effects.length, before.effects.length + 1);
  assert.deepEqual(after.movements.filter(row => row.operationKey !== key), before.movements);
  assert.deepEqual(after.effects.filter(row => row.operationKey !== key), before.effects);
  const movement = after.movements.find(row => row.operationKey === key);
  const effect = after.effects.find(row => row.operationKey === key);
  assert.ok(movement && effect);
  assert.equal(movement.variantId, variantId);
  assert.equal(movement.delta, 2);
  assert.equal(movement.inventoryVersion, 5);
  assert.equal(movement.reason, InventoryReason.RETURN_RECEIVED);
  assert.equal(movement.refType, 'RETURN_RECEIPT_ITEM');
  assert.equal(movement.refId, 7);
  assert.equal(movement.createdBy, actorId);
  assert.equal(movement.sourceDocumentId, doc);
  assert.equal(effect.variantId, variantId);
  assert.equal(effect.orderId, orderId);
  assert.equal(effect.delta, 2);
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
  assert.equal(after.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length, 5);
  return { stock, movement, effect, pending };
}

async function main() {
  const evidence = readEvidence();
  const url = process.env.M03_TEST_DATABASE_URL;
  if (!url || !/^mysql:\/\/m03_test_user:[a-f0-9]{48}@127\.0\.0\.1:3308\/for_her_fashion_m03_test$/.test(url)) {
    throw new Error('Unsafe test database target');
  }
  if (process.env.M03_RUN_RETURN_PENDING !== 'YES') {
    throw new Error('Pending reconciliation execution not authorized');
  }
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const service = new ReturnInventoryService(new InventoryLedgerService(), new PendingInventoryEffectService());
  try {
    await verifyTarget(prisma);
    console.log('Test database target PASS');
    // Run exclusively against the isolated DB. No other writer or M08 job
    // may use this fixture/source document while this runner is executing.
    const committed = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const before = await capture(tx);
      verifyBefore(before);
      const prepared = await service.prepareSourceReconciliation(tx, 'CUSTOMER_RETURN', receiptId, evidence);
      assert.equal(prepared.plans.length, 1);
      const plan = prepared.plans[0];
      assert.equal(plan.variantId, variantId);
      assert.equal(plan.previousQuantity, 8);
      assert.equal(plan.inventoryVersion, 4);
      assert.equal(plan.projectedQuantity, 10);
      assert.equal(plan.pendingDelta, '-2');
      assert.equal(plan.projectedSyncStatus, SyncState.PENDING);
      assert.deepEqual(await capture(tx), before);
      console.log('IT-R07 projection 12 + (-2) = 10; no writes during preparation PASS');
      const result = await service.applyVerifiedReturn(tx, 'CUSTOMER_RETURN', receiptId, evidence);
      assert.equal(result.length, 1);
      const after = await capture(tx);
      const { movement, effect } = verifyAfter(before, after, evidence);
      assert.deepEqual(result[0], {
        operationKey: key, variantId, movementId: String(movement.id),
        pendingEffectId: String(effect.id), inventoryVersion: 5, delta: 2,
        receiptKind: 'CUSTOMER_RETURN', receiptItemId: 7, replayed: false,
      });
      console.log('IT-R07 in-transaction stock, ledger, effect and unaffected rows PASS');
      return { before, after, result: result[0] };
    }, options);
    console.log('IT-R07 transaction committed');
    const persisted = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const state = await capture(tx);
      assert.deepEqual(state, committed.after);
      return verifyAfter(committed.before, state, evidence);
    }, options);
    console.log('IT-R07 post-commit database verification PASS');
    console.log('IT-R07 original pending movement/effect unchanged; new return effect CONFIRMED PASS');
    console.log(JSON.stringify({
      caseId: 'IT-R07', runTag, orderId, receiptId, variantId,
      quantityBefore: 8, quantityAfter: persisted.stock.quantity,
      versionBefore: 4, versionAfter: persisted.stock.version,
      sourceQuantity: persisted.stock.sourceQuantity, syncStatus: persisted.stock.syncStatus,
      movementId: String(persisted.movement.id), effectId: String(persisted.effect.id),
      delta: persisted.movement.delta, effectStatus: persisted.effect.status,
      effectVersion: persisted.effect.version, sourceDocumentId: doc,
      operationKey: key, replayed: committed.result.replayed,
      pendingOrderId, pendingOperationKey: pendingKey, pendingDelta: persisted.pending.delta,
      pendingEffectId: String(persisted.pending.id), pendingEffectVersion: persisted.pending.version,
      pendingEffectStatus: persisted.pending.status, totalReturnMovements: 5,
      totalMovements: committed.after.movements.length, totalEffects: committed.after.effects.length,
    }, null, 2));
    console.log('IT-R07 PENDING RECONCILIATION INTEGRATION PASS');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('Pending reconciliation script check-only PASS. No database connection.');
} else {
  main().catch((error: unknown) => {
    // No raw Prisma error or URL in logs. Assertion messages are restricted
    // to the stage label, since deep-equality errors can contain row data.
    if (error instanceof HttpException) {
      console.error('Pending reconciliation integration FAILED: HTTP', error.getStatus());
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('Pending reconciliation integration FAILED:', error.code);
    } else {
      console.error('Pending reconciliation integration FAILED:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      if (error instanceof Error && error.stack) {
        const location = error.stack.split('\n').find(line => /\bat .*test-return-inventory-pending\.ts:\d+:\d+/.test(line));
        if (location) console.error(location.trim());
      }
    }
    process.exitCode = 1;
  });
}
