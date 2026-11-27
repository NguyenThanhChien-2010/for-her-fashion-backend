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
const orderId = 8;
const receiptId = 3;
const variantId = 7;
const actorId = 5;
const key = 'M03-RETURN-RECEIPT-ITEM-3-RESTOCK';
const doc = 'M03R-ff7ceb8f-04-RETURN';
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
  const fixture = manifest.fixtures.find(item => item.caseId === 'IT-R04');
  assert.ok(fixture);
  assert.equal(fixture.kind, 'CUSTOMER_RETURN');
  assert.equal(fixture.orderId, orderId);
  assert.equal(fixture.requestId, 3);
  assert.equal(fixture.receiptId, receiptId);
  assert.equal(fixture.lines.length, 1);
  assert.deepEqual(fixture.lines[0], {
    receiptItemId: 3, orderItemId: 9, requestItemId: 3, variantId,
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
    variantId, sourceVariantId: 'M03R-ff7ceb8f-04-1-KV',
    expectedInventoryVersion: 3, restockedQuantity: 2,
    sourceQuantity: 12, sourceVersion: 'M03R-ff7ceb8f-04-1-RETURN',
    observedAt: new Date(fixture.receivedAt), confirmedEffects: [], notReflectedEffects: [],
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
  assert.equal(before.movements.length, 13);
  assert.equal(before.effects.length, 13);
  assert.equal(before.orders.length, 9);
  assert.equal(before.orderItems.length, 10);
  assert.equal(before.receipts.length, 6);
  assert.equal(before.receiptItems.length, 7);
  assert.equal(before.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length, 3);
  assert.equal(before.movements.some(row => row.operationKey === key), false);
  assert.equal(before.effects.some(row => row.operationKey === key), false);
  // Preserve the three already accepted returns, including their ledger IDs.
  for (const prior of [
    { variantId: 4, quantity: 12, delta: 2, id: '12', key: 'M03-RETURN-RECEIPT-ITEM-1-RESTOCK' },
    { variantId: 5, quantity: 13, delta: 3, id: '13', key: 'M03-DELIVERY-RETURN-ITEM-1-RESTOCK' },
    { variantId: 6, quantity: 12, delta: 2, id: '14', key: 'M03-RETURN-RECEIPT-ITEM-2-RESTOCK' },
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
  console.log('IT-R01, IT-R02 and IT-R03 committed baselines PASS');
  const stock = before.inventory.find(row => row.variantId === variantId);
  assert.ok(stock);
  assert.equal(stock.quantity, 10);
  assert.equal(stock.version, 3);
  assert.equal(stock.sourceQuantity, 10);
  assert.equal(stock.syncStatus, SyncState.CONFIRMED);
  const order = before.orders.find(row => row.id === orderId);
  assert.ok(order);
  assert.equal(order.userId, 4);
  assert.equal(order.status, 'DELIVERED');
  const receipt = before.receipts.find(row => row.id === receiptId);
  assert.ok(receipt);
  assert.equal(receipt.requestId, 3);
  assert.equal(receipt.actorId, actorId);
  assert.equal(receipt.kiotDocumentId, doc);
  const saleKey = 'M03-ORDER-8-SKU-7-DEDUCT';
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
  console.log('IT-R04 initial stock, original deduction and no prior return PASS');
}

function verifyAfter(before: State, after: State, evidence: VerifiedReturnEvidence) {
  const snapshot = evidence.snapshots[0];
  const stock = after.inventory.find(row => row.variantId === variantId);
  assert.ok(stock);
  assert.equal(stock.quantity, 12);
  assert.equal(stock.version, 4);
  assert.equal(stock.sourceQuantity, 12);
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
  assert.equal(movement.delta, 2);
  assert.equal(movement.inventoryVersion, 4);
  assert.equal(movement.reason, InventoryReason.RETURN_RECEIVED);
  assert.equal(movement.refType, 'RETURN_RECEIPT_ITEM');
  assert.equal(movement.refId, 3);
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
  return { stock, movement, effect };
}

async function main() {
  const evidence = readEvidence();
  const url = process.env.M03_TEST_DATABASE_URL;
  if (!url || !/^mysql:\/\/m03_test_user:[a-f0-9]{48}@127\.0\.0\.1:3308\/for_her_fashion_m03_test$/.test(url)) {
    throw new Error('Unsafe test database target');
  }
  if (process.env.M03_RUN_RETURN_CONCURRENCY !== 'YES') {
    throw new Error('Return concurrency execution not authorized');
  }
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const service = new ReturnInventoryService(new InventoryLedgerService(), new PendingInventoryEffectService());
  try {
    await verifyTarget(prisma);
    console.log('Test database target PASS');
    // Only these two workers may write this fixture during the test.
    const before = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const state = await capture(tx);
      verifyBefore(state);
      return state;
    }, options);

    // Rendezvous BEFORE service calls: both transactions must be open on
    // different MySQL sessions. No external order lock or mocked service.
    const connections = new Map<string, string>();
    let releaseGate!: () => void;
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    async function waitForBoth() {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Concurrent transaction barrier timeout')), 8000);
        void gate.then(() => { clearTimeout(timer); resolve(); });
      });
    }
    const worker = (label: string) => prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const rows = await tx.$queryRaw<Array<{ connectionId: bigint }>>`
        SELECT CONNECTION_ID() AS connectionId
      `;
      assert.ok(rows[0]);
      const connectionId = String(rows[0].connectionId);
      assert.ok(/^\d+$/.test(connectionId));
      connections.set(label, connectionId);
      console.log(label + ' transaction ready; MySQL connection ' + connectionId);
      if (connections.size === 2) releaseGate();
      await waitForBoth();
      assert.equal(new Set(connections.values()).size, 2);
      console.log(label + ' invoking applyVerifiedReturn');
      const result = await service.applyVerifiedReturn(tx, 'CUSTOMER_RETURN', receiptId, evidence);
      assert.equal(result.length, 1);
      // Keep the winning transaction open briefly, allowing the other
      // invocation to compete for the order lock. Not a latency assertion.
      if (!result[0].replayed) await new Promise<void>(resolve => setTimeout(resolve, 200));
      const after = await capture(tx);
      const { movement, effect } = verifyAfter(before, after, evidence);
      assert.deepEqual(result[0], {
        operationKey: key, variantId, movementId: String(movement.id),
        pendingEffectId: String(effect.id), inventoryVersion: 4, delta: 2,
        receiptKind: 'CUSTOMER_RETURN', receiptItemId: 3, replayed: result[0].replayed,
      });
      assert.equal(typeof result[0].replayed, 'boolean');
      console.log(label + ' in-transaction verification PASS; replayed=' + result[0].replayed);
      return { label, connectionId, result: result[0], after };
    }, options);

    // Await BOTH transactions even on failure; no automatic retry and no
    // attempt to undo a worker that may already have committed.
    const settled = await Promise.allSettled([worker('A'), worker('B')]);
    for (const entry of settled) {
      if (entry.status === 'rejected') {
        console.error('At least one worker failed; inspect persisted DB before rerun');
        throw entry.reason;
      }
    }
    const a = settled[0];
    const b = settled[1];
    assert.ok(a.status === 'fulfilled' && b.status === 'fulfilled');
    assert.notEqual(a.value.connectionId, b.value.connectionId);
    assert.equal(Number(a.value.result.replayed) + Number(b.value.result.replayed), 1);
    assert.deepEqual({ ...a.value.result, replayed: true }, { ...b.value.result, replayed: true });
    assert.deepEqual(a.value.after, b.value.after);
    console.log('IT-R04 two distinct MySQL sessions, both transactions committed PASS');
    console.log('IT-R04 one new application and one replay, same historical IDs PASS');

    const persisted = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const state = await capture(tx);
      assert.deepEqual(state, a.value.after);
      assert.equal(state.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length, 4);
      return { ...verifyAfter(before, state, evidence), state };
    }, options);
    console.log('IT-R04 post-commit stock, ledger, effect and unaffected rows PASS');
    console.log(JSON.stringify({
      caseId: 'IT-R04', runTag, orderId, receiptId, variantId,
      workers: [a.value, b.value].map(w => ({ label: w.label, connectionId: w.connectionId, replayed: w.result.replayed, movementId: w.result.movementId, effectId: w.result.pendingEffectId })),
      quantityBefore: 10, quantityAfter: persisted.stock.quantity,
      versionBefore: 3, versionAfter: persisted.stock.version,
      sourceQuantity: persisted.stock.sourceQuantity, syncStatus: persisted.stock.syncStatus,
      movementId: String(persisted.movement.id), effectId: String(persisted.effect.id),
      delta: persisted.movement.delta, effectStatus: persisted.effect.status,
      effectVersion: persisted.effect.version, sourceDocumentId: doc,
      operationKey: key, newApplications: 1, successfulReplays: 1,
      totalMovements: persisted.state.movements.length, totalEffects: persisted.state.effects.length,
    }, null, 2));
    console.log('IT-R04 CONCURRENCY INTEGRATION PASS');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('Return concurrency script check-only PASS. No database connection.');
} else {
  main().catch((error: unknown) => {
    // No raw Prisma error or URL in logs. Assertion messages are restricted
    // to the stage label, since deep-equality errors can contain row data.
    if (error instanceof HttpException) {
      console.error('Return concurrency integration FAILED: HTTP', error.getStatus());
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('Return concurrency integration FAILED:', error.code);
    } else {
      console.error('Return concurrency integration FAILED:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      if (error instanceof Error && error.stack) {
        const location = error.stack.split('\n').find(line => /\bat .*test-return-inventory-concurrency\.ts:\d+:\d+/.test(line));
        if (location) console.error(location.trim());
      }
    }
    process.exitCode = 1;
  });
}
