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
import { capture, options, readFixture, runTag, verifyPriorReturns, verifyTarget } from './helpers/return-inventory-test.helper';
import type { State } from './helpers/return-inventory-test.helper';

const orderId = 10;
const receiptId = 5;
const actorId = 5;
const variantId = 10;
const operationKey = 'M03-RETURN-RECEIPT-ITEM-6-RESTOCK';

interface Fixture {
  caseId: string;
  kind: string;
  orderId: number;
  requestId: number;
  receiptId: number;
  evidence: unknown;
  lines: PreparedReturnLine[];
  baseline: unknown[];
}

function verifyManifest() {
  const fixture = readFixture<Fixture>('IT-R06', actorId);
  assert.equal(fixture.kind, 'CUSTOMER_RETURN');
  assert.equal(fixture.orderId, orderId);
  assert.equal(fixture.requestId, 5);
  assert.equal(fixture.receiptId, receiptId);
  assert.equal(fixture.evidence, null);
  assert.deepEqual(fixture.lines, [{
    receiptItemId: 6, orderItemId: 12, requestItemId: 6, variantId,
    orderedQuantity: 5, receivedQuantity: 4, acceptedQuantity: 3,
    resalableQuantity: 0, operationKey,
  }]);
  assert.deepEqual(fixture.baseline, [{
    variantId, quantity: 10, version: 3, sourceQuantity: 10,
    syncStatus: 'CONFIRMED', expectedAfter: 10,
  }]);
  console.log('IT-R06 manifest identity, SHA256 and unlinked evidence PASS');
}


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
  verifyPriorReturns(before, [
    { variantId: 4, quantity: 12, delta: 2, id: '12', key: 'M03-RETURN-RECEIPT-ITEM-1-RESTOCK' },
    { variantId: 5, quantity: 13, delta: 3, id: '13', key: 'M03-DELIVERY-RETURN-ITEM-1-RESTOCK' },
    { variantId: 6, quantity: 12, delta: 2, id: '14', key: 'M03-RETURN-RECEIPT-ITEM-2-RESTOCK' },
    { variantId: 7, quantity: 12, delta: 2, id: '15', key: 'M03-RETURN-RECEIPT-ITEM-3-RESTOCK' },
  ]);
  console.log('IT-R01 through IT-R04 committed baselines PASS');
  assert.equal(before.requests.length, 6);
  assert.equal(before.requestItems.length, 7);
  assert.equal(before.deliveryReceipts.length, 1);
  assert.equal(before.deliveryItems.length, 1);
  const order = before.orders.find(row => row.id === orderId);
  assert.ok(order);
  assert.equal(order.userId, 4);
  assert.equal(order.status, 'DELIVERED');
  const receipt = before.receipts.find(row => row.id === receiptId);
  assert.ok(receipt);
  assert.equal(receipt.requestId, 5);
  assert.equal(receipt.actorId, actorId);
  assert.equal(receipt.kiotDocumentId, null);
  const item = before.receiptItems.find(row => row.id === 6);
  assert.ok(item);
  assert.equal(item.receiptId, receiptId);
  assert.equal(item.requestItemId, 6);
  assert.equal(item.receivedQuantity, 4);
  assert.equal(item.acceptedQuantity, 3);
  assert.equal(item.resalableQuantity, 0);
  for (const id of [8, 9, variantId]) {
    const stock = before.inventory.find(row => row.variantId === id);
    assert.ok(stock);
    assert.equal(stock.quantity, 10);
    assert.equal(stock.version, 3);
    assert.equal(stock.sourceQuantity, 10);
    assert.equal(stock.syncStatus, SyncState.CONFIRMED);
  }
  for (const key of [operationKey, 'M03-RETURN-RECEIPT-ITEM-4-RESTOCK', 'M03-RETURN-RECEIPT-ITEM-5-RESTOCK']) {
    assert.equal(before.movements.some(row => row.operationKey === key), false);
    assert.equal(before.effects.some(row => row.operationKey === key), false);
  }
  const saleKey = `M03-ORDER-${orderId}-SKU-${variantId}-DEDUCT`;
  const sale = before.movements.find(row => row.operationKey === saleKey);
  const saleEffect = before.effects.find(row => row.operationKey === saleKey);
  assert.ok(sale && saleEffect);
  assert.equal(sale.reason, InventoryReason.ORDER_CREATED);
  assert.equal(sale.variantId, variantId);
  assert.equal(sale.delta, -5);
  assert.equal(saleEffect.variantId, variantId);
  assert.equal(saleEffect.orderId, orderId);
  assert.equal(saleEffect.delta, -5);
  assert.equal(saleEffect.status, SyncState.CONFIRMED);
  assert.ok(saleEffect.releasedAt);
  console.log('IT-R05 rollback baseline and IT-R06 original deduction, unlinked receipt and zero resalable quantity PASS');
}

async function main() {
  verifyManifest();
  const url = process.env.M03_TEST_DATABASE_URL;
  if (!url || !/^mysql:\/\/m03_test_user:[a-f0-9]{48}@127\.0\.0\.1:3308\/for_her_fashion_m03_test$/.test(url)) {
    throw new Error('Unsafe test database target');
  }
  if (process.env.M03_RUN_RETURN_NON_RESALABLE !== 'YES') {
    throw new Error('Non-resalable return execution not authorized');
  }
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const service = new ReturnInventoryService(new InventoryLedgerService(), new PendingInventoryEffectService());
  try {
    await verifyTarget(prisma);
    console.log('Test database target PASS');
    const readState = () => prisma.$transaction(async tx => {
      await verifyTarget(tx);
      return capture(tx);
    }, options);
    const before = await readState();
    verifyBefore(before);
    const expected = {
      receiptKind: 'CUSTOMER_RETURN', receiptId, orderId,
      outcome: 'NO_STOCK_CHANGE', restockedQuantity: 0,
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      await prisma.$transaction(async tx => {
        await verifyTarget(tx);
        assert.deepEqual(await capture(tx), before);
        const result = await service.validateNonResalableReturn(tx, 'CUSTOMER_RETURN', receiptId);
        assert.deepEqual(result, expected);
        assert.deepEqual(await capture(tx), before);
      }, options);
      assert.deepEqual(await readState(), before);
      console.log(`IT-R06 validation ${attempt}: NO_STOCK_CHANGE, all captured rows unchanged PASS`);
    }
    // This receipt has no linked source document. Even an empty snapshot list
    // must not bypass source validation. No receipt mutation is performed.
    const unlinkedEvidence: VerifiedReturnEvidence = {
      receiptKind: 'CUSTOMER_RETURN', receiptId,
      sourceDocumentId: `M03R-${runTag}-06-UNLINKED`, snapshots: [],
    };
    async function verifyConflict(label: string, action: (tx: Prisma.TransactionClient) => Promise<unknown>) {
      await assert.rejects(prisma.$transaction(async tx => {
        await verifyTarget(tx);
        assert.deepEqual(await capture(tx), before);
        await action(tx);
      }, options), (error: unknown) => {
        if (!(error instanceof HttpException) || error.getStatus() !== 409) return false;
        const response = error.getResponse();
        return typeof response === 'object' && response !== null && 'code' in response && response.code === 'CONFLICT';
      });
      assert.deepEqual(await readState(), before);
      console.log(label + ' CONFLICT (409), all captured rows unchanged PASS');
    }
    await verifyConflict('IT-R06 unlinked source evidence rejected', tx =>
      service.applyVerifiedReturn(tx, 'CUSTOMER_RETURN', receiptId, unlinkedEvidence));
    // IT-R05 has positive resalable quantities and no persisted return writes.
    // It cannot use the no-stock path instead of the verified return path.
    await verifyConflict('IT-R05 positive receipt rejected by no-stock path', tx =>
      service.validateNonResalableReturn(tx, 'CUSTOMER_RETURN', 4));
    const persisted = await readState();
    assert.deepEqual(persisted, before);
    const stock = persisted.inventory.find(row => row.variantId === variantId);
    assert.ok(stock);
    console.log(JSON.stringify({
      caseId: 'IT-R06', runTag, orderId, receiptId, variantId,
      receivedQuantity: 4, acceptedQuantity: 3, resalableQuantity: 0,
      quantityBefore: 10, quantityAfter: stock.quantity,
      versionBefore: 3, versionAfter: stock.version,
      sourceQuantity: stock.sourceQuantity, syncStatus: stock.syncStatus,
      outcome: 'NO_STOCK_CHANGE', successfulValidations: 2,
      unlinkedEvidenceRejected: true, positiveReceiptRejected: true,
      newPersistedReturnMovements: 0, newPersistedReturnEffects: 0,
      totalMovements: persisted.movements.length, totalEffects: persisted.effects.length,
      totalReturnMovements: persisted.movements.filter(row => row.reason === InventoryReason.RETURN_RECEIVED).length,
    }, null, 2));
    console.log('IT-R06 NON-RESALABLE RETURN INTEGRATION PASS');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('Non-resalable return script check-only PASS. No database connection.');
} else {
  main().catch((error: unknown) => {
    // No raw Prisma error or URL in logs. Assertion messages are restricted
    // to the stage label, since deep-equality errors can contain row data.
    if (error instanceof HttpException) {
      console.error('Non-resalable return integration FAILED: HTTP', error.getStatus());
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('Non-resalable return integration FAILED:', error.code);
    } else {
      console.error('Non-resalable return integration FAILED:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      if (error instanceof Error && error.stack) {
        const location = error.stack.split('\n').find(line => /\bat .*test-return-inventory-non-resalable\.ts:\d+:\d+/.test(line));
        if (location) console.error(location.trim());
      }
    }
    process.exitCode = 1;
  });
}
