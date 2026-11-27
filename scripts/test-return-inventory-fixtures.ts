import 'reflect-metadata';

import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import {
  DeliveryStatus,
  InventoryReason,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductStatus,
  ReturnStatus,
  SyncState,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { InventoryLedgerService } from '../src/modules/inventory/inventory-ledger.service';
import { OrderInventoryService } from '../src/modules/inventory/order-inventory.service';
import { PendingInventoryEffectService } from '../src/modules/inventory/pending-inventory-effect.service';
import { ReturnInventoryService } from '../src/modules/inventory/return-inventory.service';
import type {
  ReturnReceiptKind,
  VerifiedReturnEvidence,
  VerifiedReturnSourceSnapshot,
} from '../src/modules/inventory/return-inventory.contract';

const database = 'for_her_fashion_m03_test';
const txOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10000,
  timeout: 60000,
};

const cases = [
  { code: 'IT-R01', kind: 'CUSTOMER_RETURN', skus: 1, resalable: 2, pending: false },
  { code: 'IT-R02', kind: 'DELIVERY_RETURN', skus: 1, resalable: 3, pending: false },
  { code: 'IT-R03', kind: 'CUSTOMER_RETURN', skus: 1, resalable: 2, pending: false },
  { code: 'IT-R04', kind: 'CUSTOMER_RETURN', skus: 1, resalable: 2, pending: false },
  { code: 'IT-R05', kind: 'CUSTOMER_RETURN', skus: 2, resalable: 2, pending: false },
  { code: 'IT-R06', kind: 'CUSTOMER_RETURN', skus: 1, resalable: 0, pending: false },
  { code: 'IT-R07', kind: 'CUSTOMER_RETURN', skus: 1, resalable: 2, pending: true },
] as const satisfies ReadonlyArray<{
  code: string;
  kind: ReturnReceiptKind;
  skus: number;
  resalable: number;
  pending: boolean;
}>;

async function verifyTarget(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ databaseName: string; serverHost: string }>>`
    SELECT DATABASE() AS databaseName, @@hostname AS serverHost
  `;
  assert.equal(rows[0]?.databaseName, database);
  assert.ok(process.env.M03_EXPECTED_HOST);
  assert.equal(rows[0]?.serverHost, process.env.M03_EXPECTED_HOST);
}

async function main() {
  const url = process.env.M03_TEST_DATABASE_URL;
  if (!url || !/^mysql:\/\/m03_test_user:[a-f0-9]{48}@127\.0\.0\.1:3308\/for_her_fashion_m03_test$/.test(url)) {
    throw new Error('Unsafe test database target');
  }
  if (process.env.M03_RUN_RETURN_FIXTURES !== 'YES') {
    throw new Error('Fixture execution not authorized');
  }
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const ledger = new InventoryLedgerService();
  const pending = new PendingInventoryEffectService();
  const orders = new OrderInventoryService(prisma, ledger);
  const returns = new ReturnInventoryService(ledger, pending);
  const tag = randomBytes(4).toString('hex');

  try {
    await verifyTarget(prisma);
    console.log('Test database target PASS');
    const manifest = await prisma.$transaction(async tx => {
      await verifyTarget(tx);
      // All rows below are new, namespaced fixtures. No existing row is updated.
      const customer = await tx.user.create({ data: {
        email: `m03-return-${tag}@example.invalid`,
        fullName: `M03 Return Test ${tag}`,
        passwordHash: 'NOT_A_LOGIN_PASSWORD',
      } });
      const actor = await tx.user.create({ data: {
        email: `m03-return-staff-${tag}@example.invalid`,
        fullName: `M03 Test Staff ${tag}`,
        passwordHash: 'NOT_A_LOGIN_PASSWORD',
        role: UserRole.STAFF,
      } });
      const category = await tx.category.create({ data: {
        name: `M03 Return ${tag}`, slug: `m03-return-${tag}`,
      } });
      const group = await tx.colorGroup.create({ data: { name: `M03 Return ${tag}` } });
      const color = await tx.color.create({ data: {
        groupId: group.id, name: `M03 Return Color ${tag}`, skuSuffix: `C${tag}`, hex: '#000000',
      } });
      const size = await tx.size.create({ data: {
        code: `T${tag}`, name: `M03 Return Size ${tag}`, skuSuffix: `T${tag}`,
      } });

      async function createOrder(code: string, quantity: number, skuCount: number) {
        return tx.order.create({ data: {
          code, userId: customer.id, status: 'AWAITING_CONFIRMATION',
          paymentMethod: PaymentMethod.COD,
          subtotal: 100000 * quantity * skuCount, shippingFee: 0,
          total: 100000 * quantity * skuCount,
          shipName: customer.fullName, shipPhone: '0000000000',
          shipEmail: customer.email, shipAddress: 'Integration test address',
          shipProvince: 'Test province', idempotencyKey: code,
        } });
      }

      const fixtures = [];
      for (const scenario of cases) {
        const prefix = `M03R-${tag}-${scenario.code.slice(-2)}`;
        const order = await createOrder(`${prefix}-O`, 5, scenario.skus);
        const lines = [];
        for (let i = 0; i < scenario.skus; i++) {
          const baseCode = `${prefix}-${i + 1}`;
          const product = await tx.product.create({ data: {
            categoryId: category.id, name: `Return Fixture ${baseCode}`,
            slug: baseCode.toLowerCase(), baseCode, price: 100000, status: ProductStatus.ACTIVE,
          } });
          const sourceVariantId = `${baseCode}-KV`;
          const variant = await tx.productVariant.create({ data: {
            productId: product.id, colorId: color.id, sizeCode: size.code,
            sku: `${baseCode}-${color.skuSuffix}-${size.skuSuffix}`,
            kiotvietVariantId: sourceVariantId, isActive: true,
          } });
          await tx.inventory.create({ data: {
            variantId: variant.id, quantity: 15, sourceQuantity: 15, version: 1,
            syncStatus: SyncState.CONFIRMED, sourceVersion: `${baseCode}-INITIAL`,
            lastConfirmedAt: new Date(Date.now() - 60000),
          } });
          const item = await tx.orderItem.create({ data: {
            orderId: order.id, variantId: variant.id, productName: product.name,
            sku: variant.sku, colorName: color.name, sizeCode: size.code,
            unitPrice: 100000, quantity: 5, lineTotal: 500000, netAmount: 500000,
          } });
          lines.push({ variant, product, item, sourceVariantId, baseCode });
        }

        // Exercise actual deduction and ledger. The sale acknowledgement is
        // simulated fixture setup, not a real KiotViet API or M08 integration.
        const deductions = await orders.deductForOrder(tx, order.id);
        assert.equal(deductions.length, lines.length);
        const saleAt = new Date();
        for (const line of lines) {
          const deduction = deductions.find(row => row.variantId === line.variant.id);
          assert.ok(deduction);
          assert.equal(deduction.delta, -5);
          assert.equal(deduction.inventoryVersion, 2);
          const confirmation = await pending.releaseConfirmed(tx, {
            operationKey: deduction.operationKey, variantId: line.variant.id,
            expectedVersion: 1, sourceDocumentId: `${prefix}-SALE`, acknowledgedAt: saleAt,
          });
          assert.equal(confirmation.status, SyncState.CONFIRMED);
          assert.equal(confirmation.replayed, false);
          const result = await tx.inventory.updateMany({
            where: { variantId: line.variant.id, quantity: 10, version: 2 },
            data: { sourceQuantity: 10, sourceVersion: `${line.baseCode}-SALE`,
              lastConfirmedAt: saleAt, syncStatus: SyncState.CONFIRMED,
              version: { increment: 1 } },
          });
          assert.equal(result.count, 1);
        }

        let pendingOrderId: number | null = null;
        if (scenario.pending) {
          const line = lines[0];
          const other = await createOrder(`${prefix}-P`, 2, 1);
          pendingOrderId = other.id;
          await tx.orderItem.create({ data: {
            orderId: other.id, variantId: line.variant.id, productName: line.product.name,
            sku: line.variant.sku, colorName: color.name, sizeCode: size.code,
            unitPrice: 100000, quantity: 2, lineTotal: 200000, netAmount: 200000,
          } });
          const result = await orders.deductForOrder(tx, other.id);
          assert.equal(result.length, 1);
          assert.equal(result[0].delta, -2);
        }

        // Ensure the observation is strictly newer than the prior sale snapshot.
        await new Promise<void>(resolve => setTimeout(resolve, 5));
        const receivedAt = new Date();
        assert.ok(receivedAt > saleAt);
        const isCustomer = scenario.kind === 'CUSTOMER_RETURN';
        await tx.order.update({ where: { id: order.id }, data: {
          status: isCustomer ? 'DELIVERED' : 'DELIVERY_UNSUCCESSFUL',
          deliveryStatus: isCustomer ? DeliveryStatus.DELIVERED : DeliveryStatus.RETURNED,
          paymentStatus: isCustomer ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          deliveredAt: isCustomer ? receivedAt : null,
          deliveryUnsuccessfulAt: isCustomer ? null : receivedAt,
          version: { increment: 1 },
        } });

        const sourceDocumentId = scenario.resalable > 0 ? `${prefix}-RETURN` : null;
        let receiptId: number;
        let requestId: number | null = null;
        if (isCustomer) {
          const request = await tx.returnRequest.create({ data: {
            code: `${prefix}-REQ`, orderId: order.id, userId: customer.id,
            status: ReturnStatus.RECEIVED, reason: 'Synthetic M03 integration fixture',
            kiotReturnDocumentId: sourceDocumentId,
          } });
          requestId = request.id;
          const receipt = await tx.returnReceipt.create({ data: {
            requestId: request.id, operationKey: `${prefix}-RECEIPT`,
            kiotDocumentId: sourceDocumentId, actorId: actor.id, receivedAt,
          } });
          receiptId = receipt.id;
          for (const line of lines) {
            const requestItem = await tx.returnRequestItem.create({ data: {
              requestId: request.id, orderItemId: line.item.id, quantity: 4,
              approvedQuantity: 4, receivedQuantity: 4, acceptedQuantity: 3,
              resalableQuantity: scenario.resalable,
            } });
            await tx.returnReceiptItem.create({ data: {
              receiptId, requestItemId: requestItem.id, receivedQuantity: 4,
              acceptedQuantity: 3, resalableQuantity: scenario.resalable,
              netAmountDelta: 300000,
            } });
          }
        } else {
          assert.ok(sourceDocumentId);
          const receipt = await tx.deliveryReturnReceipt.create({ data: {
            orderId: order.id, sourceKey: `${prefix}-RECEIPT`,
            kiotDocumentId: sourceDocumentId, receivedAt, actorId: null,
          } });
          receiptId = receipt.id;
          for (const line of lines) {
            await tx.deliveryReturnItem.create({ data: {
              receiptId, orderItemId: line.item.id, receivedQuantity: 5,
              resalableQuantity: scenario.resalable,
            } });
          }
        }

        const snapshots: VerifiedReturnSourceSnapshot[] = [];
        const baseline = [];
        for (const line of lines) {
          const inventory = await tx.inventory.findUniqueOrThrow({ where: { variantId: line.variant.id } });
          const effects = await tx.pendingInventoryEffect.findMany({ where: {
            variantId: line.variant.id, releasedAt: null,
          } });
          assert.equal(inventory.quantity, scenario.pending ? 8 : 10);
          assert.equal(inventory.version, scenario.pending ? 4 : 3);
          assert.equal(inventory.sourceQuantity, 10);
          assert.equal(effects.length, scenario.pending ? 1 : 0);
          assert.ok(effects.every(row => row.status === SyncState.PENDING && row.delta === -2));
          assert.equal(await tx.inventoryMovement.count({ where: {
            variantId: line.variant.id, reason: InventoryReason.RETURN_RECEIVED,
          } }), 0);
          baseline.push({ variantId: line.variant.id, quantity: inventory.quantity,
            version: inventory.version, sourceQuantity: inventory.sourceQuantity,
            syncStatus: inventory.syncStatus, expectedAfter: inventory.quantity + scenario.resalable });
          if (scenario.resalable > 0) {
            snapshots.push({ variantId: line.variant.id, sourceVariantId: line.sourceVariantId,
              expectedInventoryVersion: inventory.version, restockedQuantity: scenario.resalable,
              sourceQuantity: 10 + scenario.resalable, sourceVersion: `${line.baseCode}-RETURN`,
              observedAt: receivedAt, confirmedEffects: [],
              notReflectedEffects: effects.map(row => ({ operationKey: row.operationKey, expectedVersion: row.version })),
            });
          }
        }
        const evidence: VerifiedReturnEvidence | null = sourceDocumentId === null ? null : {
          receiptKind: scenario.kind, receiptId, sourceDocumentId, snapshots,
        };
        if (evidence) {
          const prepared = await returns.prepareSourceReconciliation(tx, scenario.kind, receiptId, evidence);
          assert.equal(prepared.plans.length, lines.length);
          for (const plan of prepared.plans) {
            assert.equal(plan.projectedQuantity - plan.previousQuantity, scenario.resalable);
          }
        } else {
          const result = await returns.validateNonResalableReturn(tx, scenario.kind, receiptId);
          assert.equal(result.outcome, 'NO_STOCK_CHANGE');
        }
        const prepared = await returns.prepareReceipt(tx, scenario.kind, receiptId);
        fixtures.push({ caseId: scenario.code, kind: scenario.kind, orderId: order.id,
          pendingOrderId, requestId, receiptId, receivedAt, evidence, baseline,
          lines: prepared.lines });
      }
      assert.equal(fixtures.length, 7);
      assert.equal(fixtures.reduce((count, fixture) => count + fixture.lines.length, 0), 8);
      return { runTag: tag, customerId: customer.id, actorId: actor.id, fixtures };
    }, txOptions);

    // Only emit the manifest after the fixture transaction has committed.
    // Dates in JSON must be restored to Date objects by the later test runner.
    console.log('FIXTURE_MANIFEST_JSON_BEGIN');
    console.log(JSON.stringify(manifest, null, 2));
    console.log('FIXTURE_MANIFEST_JSON_END');
    console.log('7 fixture scenarios committed; 8 original order lines prepared.');
    console.log('No RETURN_RECEIVED movement applied by this fixture script.');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  assert.equal(cases.length, 7);
  assert.equal(cases.reduce((count, scenario) => count + scenario.skus, 0), 8);
  console.log('Return fixture script check-only PASS. No database connection.');
} else {
  main().catch((error: unknown) => {
    // Avoid logging a connection URL or credentials.
    console.error('Return fixture setup failed:', error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof Error ? error.name : 'UNKNOWN_ERROR');
    process.exitCode = 1;
  });
}
