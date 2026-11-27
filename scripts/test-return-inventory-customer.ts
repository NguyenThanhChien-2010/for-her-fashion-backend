import 'reflect-metadata';

import { strict as assert } from 'node:assert';
import { HttpException } from '@nestjs/common';
import { InventoryReason, Prisma, SyncState } from '@prisma/client';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { InventoryLedgerService } from '../src/modules/inventory/inventory-ledger.service';
import { PendingInventoryEffectService } from '../src/modules/inventory/pending-inventory-effect.service';
import { ReturnInventoryService } from '../src/modules/inventory/return-inventory.service';
import type { PreparedReturnLine } from '../src/modules/inventory/return-inventory.service';
import type { VerifiedReturnEvidence } from '../src/modules/inventory/return-inventory.contract';
import { capture, options, readFixture, restoreEvidence, runTag, verifyConfirmedReturn, verifyTarget } from './helpers/return-inventory-test.helper';
import type { JsonEvidence, State } from './helpers/return-inventory-test.helper';

const orderId = 5;
const receiptId = 1;
const variantId = 4;
const actorId = 5;
const key = 'M03-RETURN-RECEIPT-ITEM-1-RESTOCK';
const doc = 'M03R-ff7ceb8f-01-RETURN';

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
  const fixture = readFixture<Fixture>('IT-R01', actorId, 'Manifest SHA256 mismatch');
  assert.equal(fixture.kind, 'CUSTOMER_RETURN');
  assert.equal(fixture.orderId, orderId);
  assert.equal(fixture.requestId, 1);
  assert.equal(fixture.receiptId, receiptId);
  assert.equal(fixture.lines.length, 1);
  assert.deepEqual(fixture.lines[0], {
    receiptItemId: 1, orderItemId: 6, requestItemId: 1, variantId,
    orderedQuantity: 5, receivedQuantity: 4, acceptedQuantity: 3,
    resalableQuantity: 2, operationKey: key,
  });
  const evidence = restoreEvidence(fixture.evidence);
  assert.equal(evidence.receiptKind, 'CUSTOMER_RETURN');
  assert.equal(evidence.receiptId, receiptId);
  assert.equal(evidence.sourceDocumentId, doc);
  assert.equal(evidence.snapshots.length, 1);
  assert.deepEqual(evidence.snapshots[0], {
    variantId, sourceVariantId: 'M03R-ff7ceb8f-01-1-KV',
    expectedInventoryVersion: 3, restockedQuantity: 2,
    sourceQuantity: 12, sourceVersion: 'M03R-ff7ceb8f-01-1-RETURN',
    observedAt: new Date(fixture.receivedAt), confirmedEffects: [], notReflectedEffects: [],
  });
  assert.ok(Number.isFinite(evidence.snapshots[0].observedAt.getTime()));
  console.log('Manifest identity, SHA256 and Date restoration PASS');
  return evidence;
}


function verifyBefore(before: State) {
  assert.equal(before.inventory.length, 11);
  assert.equal(before.movements.length, 10);
  assert.equal(before.effects.length, 10);
  assert.equal(before.orders.length, 9);
  assert.equal(before.orderItems.length, 10);
  assert.equal(before.receipts.length, 6);
  assert.equal(before.receiptItems.length, 7);
  assert.equal(before.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length, 0);
  assert.equal(before.movements.some(row => row.operationKey === key), false);
  assert.equal(before.effects.some(row => row.operationKey === key), false);
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
  assert.equal(receipt.requestId, 1);
  assert.equal(receipt.actorId, actorId);
  assert.equal(receipt.kiotDocumentId, doc);
  const saleKey = 'M03-ORDER-5-SKU-4-DEDUCT';
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
  console.log('IT-R01 initial stock, original deduction and no prior return PASS');
}

function verifyAfter(before: State, after: State, evidence: VerifiedReturnEvidence) {
  return verifyConfirmedReturn(before, after, evidence, {
    variantId, orderId, key, doc, actorId, quantity: 12, delta: 2,
    refType: 'RETURN_RECEIPT_ITEM', refId: 1,
  });
}

async function main() {
  const evidence = readEvidence();
  const url = process.env.M03_TEST_DATABASE_URL;
  if (!url || !/^mysql:\/\/m03_test_user:[a-f0-9]{48}@127\.0\.0\.1:3308\/for_her_fashion_m03_test$/.test(url)) {
    throw new Error('Unsafe test database target');
  }
  if (process.env.M03_RUN_RETURN_CUSTOMER !== 'YES') {
    throw new Error('Customer return execution not authorized');
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
      const result = await service.applyVerifiedReturn(tx, 'CUSTOMER_RETURN', receiptId, evidence);
      assert.equal(result.length, 1);
      const after = await capture(tx);
      const { movement, effect } = verifyAfter(before, after, evidence);
      assert.deepEqual(result[0], {
        operationKey: key, variantId, movementId: String(movement.id),
        pendingEffectId: String(effect.id), inventoryVersion: 4, delta: 2,
        receiptKind: 'CUSTOMER_RETURN', receiptItemId: 1, replayed: false,
      });
      console.log('IT-R01 in-transaction stock, ledger, effect and unaffected rows PASS');
      return { before, after, result: result[0] };
    }, options);
    console.log('IT-R01 transaction committed');
    const persisted = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      const state = await capture(tx);
      assert.deepEqual(state, committed.after);
      return verifyAfter(committed.before, state, evidence);
    }, options);
    console.log('IT-R01 post-commit database verification PASS');
    console.log(JSON.stringify({
      caseId: 'IT-R01', runTag, orderId, receiptId, variantId,
      quantityBefore: 10, quantityAfter: persisted.stock.quantity,
      versionBefore: 3, versionAfter: persisted.stock.version,
      sourceQuantity: persisted.stock.sourceQuantity, syncStatus: persisted.stock.syncStatus,
      movementId: String(persisted.movement.id), effectId: String(persisted.effect.id),
      delta: persisted.movement.delta, effectStatus: persisted.effect.status,
      effectVersion: persisted.effect.version, sourceDocumentId: doc,
      operationKey: key, replayed: committed.result.replayed,
      totalMovements: committed.after.movements.length, totalEffects: committed.after.effects.length,
    }, null, 2));
    console.log('IT-R01 CUSTOMER RETURN INTEGRATION PASS');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('Customer return script check-only PASS. No database connection.');
} else {
  main().catch((error: unknown) => {
    // No raw Prisma error or URL in logs. Assertion messages are restricted
    // to the stage label, since deep-equality errors can contain row data.
    if (error instanceof HttpException) {
      console.error('Customer return integration FAILED: HTTP', error.getStatus());
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('Customer return integration FAILED:', error.code);
    } else {
      console.error('Customer return integration FAILED:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      if (error instanceof Error && error.stack) {
        const location = error.stack.split('\n').find(line => /\bat .*test-return-inventory-customer\.ts:\d+:\d+/.test(line));
        if (location) console.error(location.trim());
      }
    }
    process.exitCode = 1;
  });
}
