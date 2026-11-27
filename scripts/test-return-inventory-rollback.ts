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
const orderId = 9;
const receiptId = 4;
const actorId = 5;
const doc = 'M03R-ff7ceb8f-05-RETURN';
const targets = [
  { variantId: 8, receiptItemId: 4, orderItemId: 10, requestItemId: 4, key: 'M03-RETURN-RECEIPT-ITEM-4-RESTOCK', suffix: 1 },
  { variantId: 9, receiptItemId: 5, orderItemId: 11, requestItemId: 5, key: 'M03-RETURN-RECEIPT-ITEM-5-RESTOCK', suffix: 2 },
];
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
  assert.equal(createHash('sha256').update(raw).digest('hex'), manifestHash);
  const manifest = JSON.parse(raw.toString('utf8')) as {
    runTag: string; customerId: number; actorId: number; fixtures: Fixture[];
  };
  assert.equal(manifest.runTag, runTag);
  assert.equal(manifest.customerId, 4);
  assert.equal(manifest.actorId, actorId);
  assert.equal(manifest.fixtures.length, 7);
  const fixture = manifest.fixtures.find(item => item.caseId === 'IT-R05');
  assert.ok(fixture);
  assert.equal(fixture.kind, 'CUSTOMER_RETURN');
  assert.equal(fixture.orderId, orderId);
  assert.equal(fixture.requestId, 4);
  assert.equal(fixture.receiptId, receiptId);
  assert.equal(fixture.lines.length, 2);
  const evidence: VerifiedReturnEvidence = {
    ...fixture.evidence,
    snapshots: fixture.evidence.snapshots.map(snapshot => ({
      ...snapshot, observedAt: new Date(snapshot.observedAt),
    })),
  };
  assert.equal(evidence.receiptKind, 'CUSTOMER_RETURN');
  assert.equal(evidence.receiptId, receiptId);
  assert.equal(evidence.sourceDocumentId, doc);
  assert.equal(evidence.snapshots.length, 2);
  for (const target of targets) {
    assert.deepEqual(fixture.lines.find(line => line.variantId === target.variantId), {
      receiptItemId: target.receiptItemId, orderItemId: target.orderItemId,
      requestItemId: target.requestItemId, variantId: target.variantId,
      orderedQuantity: 5, receivedQuantity: 4, acceptedQuantity: 3,
      resalableQuantity: 2, operationKey: target.key,
    });
    const snapshot = evidence.snapshots.find(item => item.variantId === target.variantId);
    assert.ok(snapshot);
    assert.deepEqual(snapshot, {
      variantId: target.variantId, sourceVariantId: `M03R-${runTag}-05-${target.suffix}-KV`,
      expectedInventoryVersion: 3, restockedQuantity: 2,
      sourceQuantity: 12, sourceVersion: `M03R-${runTag}-05-${target.suffix}-RETURN`,
      observedAt: new Date(fixture.receivedAt), confirmedEffects: [], notReflectedEffects: [],
    });
    assert.ok(Number.isFinite(snapshot.observedAt.getTime()));
  }
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
  const order = before.orders.find(row => row.id === orderId);
  assert.ok(order);
  assert.equal(order.userId, 4);
  assert.equal(order.status, 'DELIVERED');
  const receipt = before.receipts.find(row => row.id === receiptId);
  assert.ok(receipt);
  assert.equal(receipt.requestId, 4);
  assert.equal(receipt.actorId, actorId);
  assert.equal(receipt.kiotDocumentId, doc);
  for (const target of targets) {
    const stock = before.inventory.find(row => row.variantId === target.variantId);
    assert.ok(stock);
    assert.equal(stock.quantity, 10);
    assert.equal(stock.version, 3);
    assert.equal(stock.sourceQuantity, 10);
    assert.equal(stock.syncStatus, SyncState.CONFIRMED);
    assert.equal(before.movements.some(row => row.operationKey === target.key), false);
    assert.equal(before.effects.some(row => row.operationKey === target.key), false);
    const saleKey = `M03-ORDER-${orderId}-SKU-${target.variantId}-DEDUCT`;
    const sale = before.movements.find(row => row.operationKey === saleKey);
    const saleEffect = before.effects.find(row => row.operationKey === saleKey);
    assert.ok(sale && saleEffect);
    assert.equal(sale.reason, InventoryReason.ORDER_CREATED);
    assert.equal(sale.variantId, target.variantId);
    assert.equal(sale.delta, -5);
    assert.equal(saleEffect.variantId, target.variantId);
    assert.equal(saleEffect.orderId, orderId);
    assert.equal(saleEffect.delta, -5);
    assert.equal(saleEffect.status, SyncState.CONFIRMED);
    assert.ok(saleEffect.releasedAt);
  }
  console.log('IT-R05 initial stocks, original deductions and no prior returns PASS');
}

function verifyWritten(before: State, written: State, evidence: VerifiedReturnEvidence) {
  const targetIds = targets.map(target => target.variantId);
  const keys = targets.map(target => target.key);
  assert.deepEqual(written.inventory.filter(row => !targetIds.includes(row.variantId)), before.inventory.filter(row => !targetIds.includes(row.variantId)));
  assert.equal(written.movements.length, before.movements.length + 2);
  assert.equal(written.effects.length, before.effects.length + 2);
  assert.equal(written.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length, 6);
  assert.deepEqual(written.movements.filter(row => !keys.includes(row.operationKey)), before.movements);
  assert.deepEqual(written.effects.filter(row => !keys.includes(row.operationKey)), before.effects);
  const records = targets.map(target => {
    const snapshot = evidence.snapshots.find(item => item.variantId === target.variantId);
    const stock = written.inventory.find(row => row.variantId === target.variantId);
    const movement = written.movements.find(row => row.operationKey === target.key);
    const effect = written.effects.find(row => row.operationKey === target.key);
    assert.ok(snapshot && stock && movement && effect);
    assert.equal(stock.quantity, 12);
    assert.equal(stock.version, 4);
    assert.equal(stock.sourceQuantity, 12);
    assert.equal(stock.sourceVersion, snapshot.sourceVersion);
    assert.deepEqual(stock.lastConfirmedAt, snapshot.observedAt);
    assert.equal(stock.syncStatus, SyncState.CONFIRMED);
    assert.equal(movement.variantId, target.variantId);
    assert.equal(movement.delta, 2);
    assert.equal(movement.inventoryVersion, 4);
    assert.equal(movement.reason, InventoryReason.RETURN_RECEIVED);
    assert.equal(movement.refType, 'RETURN_RECEIPT_ITEM');
    assert.equal(movement.refId, target.receiptItemId);
    assert.equal(movement.createdBy, actorId);
    assert.equal(movement.sourceDocumentId, doc);
    assert.equal(effect.variantId, target.variantId);
    assert.equal(effect.orderId, orderId);
    assert.equal(effect.delta, 2);
    assert.equal(effect.version, 2);
    assert.equal(effect.status, SyncState.CONFIRMED);
    assert.equal(effect.sourceDocumentId, doc);
    assert.deepEqual(effect.sourceAcknowledgedAt, snapshot.observedAt);
    assert.ok(effect.releasedAt instanceof Date);
    assert.ok(effect.releasedAt.getTime() >= snapshot.observedAt.getTime());
    return { target, stock, movement, effect };
  });
  assert.deepEqual(written.orders, before.orders);
  assert.deepEqual(written.orderItems, before.orderItems);
  assert.deepEqual(written.requests, before.requests);
  assert.deepEqual(written.requestItems, before.requestItems);
  assert.deepEqual(written.receipts, before.receipts);
  assert.deepEqual(written.receiptItems, before.receiptItems);
  assert.deepEqual(written.deliveryReceipts, before.deliveryReceipts);
  assert.deepEqual(written.deliveryItems, before.deliveryItems);
  return records;
}

async function main() {
  const evidence = readEvidence();
  const url = process.env.M03_TEST_DATABASE_URL;
  if (!url || !/^mysql:\/\/m03_test_user:[a-f0-9]{48}@127\.0\.0\.1:3308\/for_her_fashion_m03_test$/.test(url)) {
    throw new Error('Unsafe test database target');
  }
  if (process.env.M03_RUN_RETURN_ROLLBACK !== 'YES') {
    throw new Error('Return rollback execution not authorized');
  }
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const service = new ReturnInventoryService(new InventoryLedgerService(), new PendingInventoryEffectService());
  try {
    await verifyTarget(prisma);
    console.log('Test database target PASS');
    const before = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const state = await capture(tx);
      verifyBefore(state);
      return state;
    }, options);

    // Deliberate caller failure AFTER real writes. Never swallow this error
    // inside the transaction callback. Only this exact sentinel is accepted.
    const deliberate = new Error('IT-R05 deliberate rollback after verified writes');
    let writesVerified = false;
    let observed: Array<{ variantId: number; quantity: number; version: number; movementId: string; effectId: string }> = [];
    try {
      await prisma.$transaction(async tx => {
        await verifyTarget(tx);
        assert.deepEqual(await capture(tx), before);
        const result = await service.applyVerifiedReturn(tx, 'CUSTOMER_RETURN', receiptId, evidence);
        const written = await capture(tx);
        const records = verifyWritten(before, written, evidence);
        assert.equal(result.length, 2);
        for (const { target, movement, effect } of records) {
          assert.deepEqual(result.find(row => row.variantId === target.variantId), {
            operationKey: target.key, variantId: target.variantId,
            movementId: String(movement.id), pendingEffectId: String(effect.id),
            inventoryVersion: 4, delta: 2, receiptKind: 'CUSTOMER_RETURN',
            receiptItemId: target.receiptItemId, replayed: false,
          });
        }
        observed = records.map(({ target, stock, movement, effect }) => ({
          variantId: target.variantId, quantity: stock.quantity, version: stock.version,
          movementId: String(movement.id), effectId: String(effect.id),
        }));
        console.log('IT-R05 both SKU writes and both ledger/effect pairs verified inside transaction PASS');
        console.log('Uncommitted writes:', JSON.stringify(observed));
        writesVerified = true;
        throw deliberate;
      }, options);
      throw new Error('Unexpected commit: rollback sentinel did not escape');
    } catch (error) {
      assert.ok(writesVerified && error === deliberate, 'Unexpected transaction error');
      console.log('IT-R05 deliberate rollback sentinel propagated PASS');
    }

    const persisted = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const state = await capture(tx);
      assert.deepEqual(state, before);
      for (const target of targets) {
        const stock = state.inventory.find(row => row.variantId === target.variantId);
        assert.ok(stock);
        assert.equal(stock.quantity, 10);
        assert.equal(stock.version, 3);
        assert.equal(state.movements.some(row => row.operationKey === target.key), false);
        assert.equal(state.effects.some(row => row.operationKey === target.key), false);
      }
      return state;
    }, options);
    console.log('IT-R05 all captured rows restored after rollback PASS');
    console.log(JSON.stringify({
      caseId: 'IT-R05', runTag, orderId, receiptId,
      insideTransaction: observed,
      afterRollback: targets.map(target => ({ variantId: target.variantId, quantity: persisted.inventory.find(row => row.variantId === target.variantId)?.quantity, version: persisted.inventory.find(row => row.variantId === target.variantId)?.version })),
      rolledBack: true, newPersistedReturnMovements: 0, newPersistedReturnEffects: 0,
      totalMovements: persisted.movements.length, totalEffects: persisted.effects.length,
      totalReturnMovements: persisted.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length,
    }, null, 2));
    console.log('IT-R05 TRANSACTION ROLLBACK INTEGRATION PASS');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('Return rollback script check-only PASS. No database connection.');
} else {
  main().catch((error: unknown) => {
    // No raw Prisma error or URL in logs. Assertion messages are restricted
    // to the stage label, since deep-equality errors can contain row data.
    if (error instanceof HttpException) {
      console.error('Return rollback integration FAILED: HTTP', error.getStatus());
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('Return rollback integration FAILED:', error.code);
    } else {
      console.error('Return rollback integration FAILED:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      if (error instanceof Error && error.stack) {
        const location = error.stack.split('\n').find(line => /\bat .*test-return-inventory-rollback\.ts:\d+:\d+/.test(line));
        if (location) console.error(location.trim());
      }
    }
    process.exitCode = 1;
  });
}
