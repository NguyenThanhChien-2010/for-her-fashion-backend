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
const orderId = 6;
const receiptId = 1;
const variantId = 5;
const manifestActorId = 5;
const actorId = null;
const key = 'M03-DELIVERY-RETURN-ITEM-1-RESTOCK';
const doc = 'M03R-ff7ceb8f-02-RETURN';
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
  requestId: number | null;
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
  assert.equal(manifest.actorId, manifestActorId);
  assert.equal(manifest.fixtures.length, 7);
  const fixture = manifest.fixtures.find(item => item.caseId === 'IT-R02');
  assert.ok(fixture);
  assert.equal(fixture.kind, 'DELIVERY_RETURN');
  assert.equal(fixture.orderId, orderId);
  assert.equal(fixture.requestId, null);
  assert.equal(fixture.receiptId, receiptId);
  assert.equal(fixture.lines.length, 1);
  assert.deepEqual(fixture.lines[0], {
    receiptItemId: 1, orderItemId: 7, requestItemId: null, variantId,
    orderedQuantity: 5, receivedQuantity: 5, acceptedQuantity: null,
    resalableQuantity: 3, operationKey: key,
  });
  const evidence: VerifiedReturnEvidence = {
    ...fixture.evidence,
    snapshots: fixture.evidence.snapshots.map(snapshot => ({
      ...snapshot, observedAt: new Date(snapshot.observedAt),
    })),
  };
  assert.equal(evidence.receiptKind, 'DELIVERY_RETURN');
  assert.equal(evidence.receiptId, receiptId);
  assert.equal(evidence.sourceDocumentId, doc);
  assert.equal(evidence.snapshots.length, 1);
  assert.deepEqual(evidence.snapshots[0], {
    variantId, sourceVariantId: 'M03R-ff7ceb8f-02-1-KV',
    expectedInventoryVersion: 3, restockedQuantity: 3,
    sourceQuantity: 13, sourceVersion: 'M03R-ff7ceb8f-02-1-RETURN',
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
  assert.equal(before.movements.length, 11);
  assert.equal(before.effects.length, 11);
  assert.equal(before.orders.length, 9);
  assert.equal(before.orderItems.length, 10);
  assert.equal(before.receipts.length, 6);
  assert.equal(before.receiptItems.length, 7);
  assert.equal(before.deliveryReceipts.length, 1);
  assert.equal(before.deliveryItems.length, 1);
  assert.equal(before.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length, 1);
  assert.equal(before.movements.some(row => row.operationKey === key), false);
  assert.equal(before.effects.some(row => row.operationKey === key), false);
  const previousStock = before.inventory.find(row => row.variantId === 4);
  const previousMovement = before.movements.find(row => row.operationKey === 'M03-RETURN-RECEIPT-ITEM-1-RESTOCK');
  const previousEffect = before.effects.find(row => row.operationKey === 'M03-RETURN-RECEIPT-ITEM-1-RESTOCK');
  assert.ok(previousStock && previousMovement && previousEffect);
  assert.equal(previousStock.quantity, 12);
  assert.equal(previousStock.version, 4);
  assert.equal(previousStock.sourceQuantity, 12);
  assert.equal(previousStock.syncStatus, SyncState.CONFIRMED);
  assert.equal(String(previousMovement.id), '12');
  assert.equal(previousMovement.delta, 2);
  assert.equal(previousMovement.reason, InventoryReason.RETURN_RECEIVED);
  assert.equal(String(previousEffect.id), '12');
  assert.equal(previousEffect.delta, 2);
  assert.equal(previousEffect.status, SyncState.CONFIRMED);
  assert.equal(previousEffect.version, 2);
  console.log('IT-R01 committed baseline PASS');
  const stock = before.inventory.find(row => row.variantId === variantId);
  assert.ok(stock);
  assert.equal(stock.quantity, 10);
  assert.equal(stock.version, 3);
  assert.equal(stock.sourceQuantity, 10);
  assert.equal(stock.syncStatus, SyncState.CONFIRMED);
  const order = before.orders.find(row => row.id === orderId);
  assert.ok(order);
  assert.equal(order.userId, 4);
  assert.equal(order.status, 'DELIVERY_UNSUCCESSFUL');
  assert.equal(order.deliveryStatus, 'RETURNED');
  const receipt = before.deliveryReceipts.find(row => row.id === receiptId);
  assert.ok(receipt);
  assert.equal(receipt.orderId, orderId);
  assert.equal(receipt.actorId, actorId);
  assert.equal(receipt.kiotDocumentId, doc);
  const item = before.deliveryItems.find(row => row.id === 1);
  assert.ok(item);
  assert.equal(item.receiptId, receiptId);
  assert.equal(item.orderItemId, 7);
  assert.equal(item.receivedQuantity, 5);
  assert.equal(item.resalableQuantity, 3);
  const saleKey = 'M03-ORDER-6-SKU-5-DEDUCT';
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
  console.log('IT-R02 initial stock, original deduction and no prior return PASS');
}

function verifyAfter(before: State, after: State, evidence: VerifiedReturnEvidence) {
  const snapshot = evidence.snapshots[0];
  const stock = after.inventory.find(row => row.variantId === variantId);
  assert.ok(stock);
  assert.equal(stock.quantity, 13);
  assert.equal(stock.version, 4);
  assert.equal(stock.sourceQuantity, 13);
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
  assert.equal(movement.delta, 3);
  assert.equal(movement.inventoryVersion, 4);
  assert.equal(movement.reason, InventoryReason.RETURN_RECEIVED);
  assert.equal(movement.refType, 'DELIVERY_RETURN_ITEM');
  assert.equal(movement.refId, 1);
  assert.equal(movement.createdBy, actorId);
  assert.equal(movement.sourceDocumentId, doc);
  assert.equal(effect.variantId, variantId);
  assert.equal(effect.orderId, orderId);
  assert.equal(effect.delta, 3);
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
  if (process.env.M03_RUN_RETURN_DELIVERY !== 'YES') {
    throw new Error('Delivery return execution not authorized');
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
      const result = await service.applyVerifiedReturn(tx, 'DELIVERY_RETURN', receiptId, evidence);
      assert.equal(result.length, 1);
      const after = await capture(tx);
      const { movement, effect } = verifyAfter(before, after, evidence);
      assert.deepEqual(result[0], {
        operationKey: key, variantId, movementId: String(movement.id),
        pendingEffectId: String(effect.id), inventoryVersion: 4, delta: 3,
        receiptKind: 'DELIVERY_RETURN', receiptItemId: 1, replayed: false,
      });
      console.log('IT-R02 in-transaction stock, ledger, effect and unaffected rows PASS');
      return { before, after, result: result[0] };
    }, options);
    console.log('IT-R02 transaction committed');
    const persisted = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const state = await capture(tx);
      assert.deepEqual(state, committed.after);
      return verifyAfter(committed.before, state, evidence);
    }, options);
    console.log('IT-R02 post-commit database verification PASS');
    console.log(JSON.stringify({
      caseId: 'IT-R02', runTag, orderId, receiptId, variantId,
      quantityBefore: 10, quantityAfter: persisted.stock.quantity,
      versionBefore: 3, versionAfter: persisted.stock.version,
      sourceQuantity: persisted.stock.sourceQuantity, syncStatus: persisted.stock.syncStatus,
      movementId: String(persisted.movement.id), effectId: String(persisted.effect.id),
      delta: persisted.movement.delta, effectStatus: persisted.effect.status,
      effectVersion: persisted.effect.version, sourceDocumentId: doc,
      operationKey: key, replayed: committed.result.replayed,
      totalMovements: committed.after.movements.length, totalEffects: committed.after.effects.length,
    }, null, 2));
    console.log('IT-R02 DELIVERY RETURN INTEGRATION PASS');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('Delivery return script check-only PASS. No database connection.');
} else {
  main().catch((error: unknown) => {
    // No raw Prisma error or URL in logs. Assertion messages are restricted
    // to the stage label, since deep-equality errors can contain row data.
    if (error instanceof HttpException) {
      console.error('Delivery return integration FAILED: HTTP', error.getStatus());
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('Delivery return integration FAILED:', error.code);
    } else {
      console.error('Delivery return integration FAILED:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      if (error instanceof Error && error.stack) {
        const location = error.stack.split('\n').find(line => /\bat .*test-return-inventory-delivery\.ts:\d+:\d+/.test(line));
        if (location) console.error(location.trim());
      }
    }
    process.exitCode = 1;
  });
}
