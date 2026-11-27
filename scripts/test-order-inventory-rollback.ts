import 'reflect-metadata';

import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';

import {
  InventoryReason,
  PaymentMethod,
  Prisma,
  ProductStatus,
  SyncState,
} from '@prisma/client';

import { PrismaService } from '../src/modules/prisma/prisma.service';
import { InventoryLedgerService } from '../src/modules/inventory/inventory-ledger.service';
import { OrderInventoryService } from '../src/modules/inventory/order-inventory.service';

const expectedDatabase = 'for_her_fashion_m03_test';

const txOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10000,
  timeout: 30000,
};

function errorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();

    if (typeof response === 'object' && response !== null) {
      return (
        (response as { code?: string }).code ??
        `HTTP_${error.getStatus()}`
      );
    }

    return `HTTP_${error.getStatus()}`;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }

  return error instanceof Error
    ? error.name
    : 'UNKNOWN_ERROR';
}

function assertStockError(error: unknown): void {
  assert.ok(
    error instanceof HttpException,
    'Expected business HttpException',
  );

  assert.equal(error.getStatus(), 409);

  assert.equal(
    errorCode(error),
    'INSUFFICIENT_STOCK',
  );
}

async function verifyTarget(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<
    Array<{
      databaseName: string;
      serverHost: string;
    }>
  >`
    SELECT
      DATABASE() AS databaseName,
      @@hostname AS serverHost
  `;

  assert.equal(
    rows[0]?.databaseName,
    expectedDatabase,
  );

  assert.ok(process.env.M03_EXPECTED_HOST);

  assert.equal(
    rows[0]?.serverHost,
    process.env.M03_EXPECTED_HOST,
  );

  console.log('TEST DATABASE TARGET PASS');
}

async function createFixture(
  prisma: PrismaService,
  tag: string,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `m03-rb-${tag}@example.invalid`,
        fullName: 'M03 Rollback Customer',
        passwordHash: 'NOT_A_LOGIN_PASSWORD',
      },
    });

    const category = await tx.category.create({
      data: {
        name: `M03 Rollback Category ${tag}`,
        slug: `m03-rb-category-${tag}`,
      },
    });

    const group = await tx.colorGroup.create({
      data: {
        name: `M03 Rollback Group ${tag}`,
      },
    });

    const color = await tx.color.create({
      data: {
        groupId: group.id,
        name: `M03 Rollback Color ${tag}`,
        skuSuffix: `R${tag.slice(0, 8)}`,
        hex: '#000000',
      },
    });

    const sizeCodeA = `A${tag.slice(0, 8)}`;
    const sizeCodeB = `B${tag.slice(0, 8)}`;

    const sizeA = await tx.size.create({
      data: {
        code: sizeCodeA,
        name: `Rollback Size A ${tag}`,
        skuSuffix: sizeCodeA,
      },
    });

    const sizeB = await tx.size.create({
      data: {
        code: sizeCodeB,
        name: `Rollback Size B ${tag}`,
        skuSuffix: sizeCodeB,
      },
    });

    const product = await tx.product.create({
      data: {
        categoryId: category.id,
        name: `M03 Rollback Product ${tag}`,
        slug: `m03-rb-product-${tag}`,
        baseCode: `M03-RB-${tag}`,
        price: 100000,
        status: ProductStatus.ACTIVE,
      },
    });

    const variantA = await tx.productVariant.create({
      data: {
        productId: product.id,
        colorId: color.id,
        sizeCode: sizeA.code,
        sku: `M03-RB-${tag}-A`,
        isActive: true,
      },
    });

    const variantB = await tx.productVariant.create({
      data: {
        productId: product.id,
        colorId: color.id,
        sizeCode: sizeB.code,
        sku: `M03-RB-${tag}-B`,
        isActive: true,
      },
    });

    assert.ok(
      variantA.id < variantB.id,
      'SKU-A must be processed first',
    );

    await tx.inventory.createMany({
      data: [
        {
          variantId: variantA.id,
          quantity: 10,
          sourceQuantity: 10,
          version: 1,
          syncStatus: SyncState.CONFIRMED,
          lastConfirmedAt: new Date(),
        },
        {
          variantId: variantB.id,
          quantity: 1,
          sourceQuantity: 1,
          version: 1,
          syncStatus: SyncState.CONFIRMED,
          lastConfirmedAt: new Date(),
        },
      ],
    });

    return {
      user,
      product,
      color,
      variantA,
      variantB,
    };
  }, txOptions);
}

async function main() {
  const url = process.env.M03_TEST_DATABASE_URL;

  if (
    !url ||
    !/^mysql:\/\/m03_test_user:[a-f0-9]{48}@127\.0\.0\.1:3308\/for_her_fashion_m03_test$/.test(url)
  ) {
    throw new Error('Invalid test database URL');
  }

  if (process.env.M03_RUN_ROLLBACK !== 'YES') {
    throw new Error('Rollback execution not authorized');
  }

  const prisma = new PrismaService({
    datasources: {
      db: {
        url,
      },
    },
  });

  const ledger = new InventoryLedgerService();

  const service = new OrderInventoryService(
    prisma,
    ledger,
  );

  try {
    await verifyTarget(prisma);

    const tag = randomBytes(6).toString('hex');

    console.log('\n========== CREATE FIXTURE ==========');
    console.log('Test run:', tag);

    const fixture = await createFixture(prisma, tag);

    const variantAId = fixture.variantA.id;
    const variantBId = fixture.variantB.id;

    const variantIds = [
      variantAId,
      variantBId,
    ];

    const orderCode = `M03-RB-${tag}`;

    console.log('SKU-A variant ID:', variantAId);
    console.log('SKU-B variant ID:', variantBId);
    console.log('Order code:', orderCode);

    const before = await prisma.inventory.findMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
      orderBy: {
        variantId: 'asc',
      },
    });

    assert.equal(before.length, 2);

    assert.equal(before[0].quantity, 10);
    assert.equal(before[1].quantity, 1);

    assert.equal(before[0].version, 1);
    assert.equal(before[1].version, 1);

    const baselineMovements =
      await prisma.inventoryMovement.count({
        where: {
          variantId: {
            in: variantIds,
          },
        },
      });

    const baselineEffects =
      await prisma.pendingInventoryEffect.count({
        where: {
          variantId: {
            in: variantIds,
          },
        },
      });

    assert.equal(baselineMovements, 0);
    assert.equal(baselineEffects, 0);

    console.log('\n========== BASELINE ==========');

    console.log('SKU-A quantity: 10');
    console.log('SKU-B quantity: 1');
    console.log('SKU-A version: 1');
    console.log('SKU-B version: 1');
    console.log('BASELINE PASS');

    const evidence = {
      orderId: 0,
      partialWriteObserved: false,
    };

    console.log('\n========== MULTI-SKU TRANSACTION ==========');

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            code: orderCode,
            userId: fixture.user.id,
            status: 'AWAITING_CONFIRMATION',
            paymentMethod: PaymentMethod.COD,
            subtotal: 800000,
            shippingFee: 0,
            total: 800000,
            shipName: 'Rollback Test Customer',
            shipPhone: '0000000000',
            shipEmail: `m03-rb-${tag}@example.invalid`,
            shipAddress: 'Rollback test address',
            shipProvince: 'Test province',
            idempotencyKey: orderCode,
          },
        });

        evidence.orderId = order.id;

        const createdItems = await tx.orderItem.createMany({
          data: [
            {
              orderId: order.id,
              variantId: variantAId,
              productName: fixture.product.name,
              sku: fixture.variantA.sku,
              colorName: fixture.color.name,
              sizeCode: fixture.variantA.sizeCode,
              unitPrice: 100000,
              quantity: 3,
              lineTotal: 300000,
              netAmount: 300000,
            },
            {
              orderId: order.id,
              variantId: variantBId,
              productName: fixture.product.name,
              sku: fixture.variantB.sku,
              colorName: fixture.color.name,
              sizeCode: fixture.variantB.sizeCode,
              unitPrice: 100000,
              quantity: 5,
              lineTotal: 500000,
              netAmount: 500000,
            },
          ],
        });

        assert.equal(createdItems.count, 2);

        console.log('Order created:', order.id);
        console.log('Order items created: 2');

        // Do not precheck all items here.
        // We must exercise a partial write before rollback.

        try {
          await service.deductForOrder(
            tx,
            order.id,
          );
        } catch (error) {
          assertStockError(error);

          console.log(
            'Business error:',
            errorCode(error),
          );

          console.log('\n========== VERIFY PARTIAL WRITE ==========');

          const partialA =
            await tx.inventory.findUniqueOrThrow({
              where: {
                variantId: variantAId,
              },
            });

          const partialB =
            await tx.inventory.findUniqueOrThrow({
              where: {
                variantId: variantBId,
              },
            });

          assert.equal(partialA.quantity, 7);
          assert.equal(partialA.version, 2);
          assert.equal(partialA.sourceQuantity, 10);
          assert.equal(
            partialA.syncStatus,
            SyncState.PENDING,
          );

          assert.deepEqual(
            partialB,
            before[1],
          );

          const movements =
            await tx.inventoryMovement.findMany({
              where: {
                variantId: {
                  in: variantIds,
                },
              },
            });

          const effects =
            await tx.pendingInventoryEffect.findMany({
              where: {
                variantId: {
                  in: variantIds,
                },
              },
            });

          const expectedKey =
            `M03-ORDER-${order.id}-SKU-${variantAId}-DEDUCT`;

          assert.equal(movements.length, 1);
          assert.equal(effects.length, 1);

          assert.equal(
            movements[0].variantId,
            variantAId,
          );

          assert.equal(
            movements[0].operationKey,
            expectedKey,
          );

          assert.equal(movements[0].delta, -3);

          assert.equal(
            movements[0].reason,
            InventoryReason.ORDER_CREATED,
          );

          assert.equal(movements[0].refId, order.id);

          assert.equal(
            movements[0].inventoryVersion,
            2,
          );

          assert.equal(
            effects[0].variantId,
            variantAId,
          );

          assert.equal(
            effects[0].operationKey,
            expectedKey,
          );

          assert.equal(effects[0].orderId, order.id);
          assert.equal(effects[0].delta, -3);

          assert.equal(
            effects[0].status,
            SyncState.PENDING,
          );

          assert.equal(effects[0].releasedAt, null);

          const orderInsideTransaction =
            await tx.order.findUniqueOrThrow({
              where: {
                id: order.id,
              },
              include: {
                items: true,
              },
            });

          assert.equal(
            orderInsideTransaction.items.length,
            2,
          );

          evidence.partialWriteObserved = true;

          console.log('SKU-A quantity inside transaction: 7');
          console.log('SKU-A version inside transaction: 2');
          console.log('SKU-B quantity inside transaction: 1');

          console.log('Temporary movements: 1');
          console.log('Temporary pending effects: 1');

          console.log('PARTIAL WRITE VERIFIED');

          // Rethrow original business error.
          // Prisma must roll back the entire transaction.

          throw error;
        }

        throw new Error(
          'Expected insufficient stock error was not thrown',
        );

      }, txOptions),

      (error: unknown) => {
        assertStockError(error);
        return true;
      },
    );

    assert.ok(evidence.orderId > 0);

    assert.equal(
      evidence.partialWriteObserved,
      true,
    );

    console.log('\n========== VERIFY AFTER ROLLBACK ==========');

    const after = await prisma.inventory.findMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
      orderBy: {
        variantId: 'asc',
      },
    });

    // Compare the complete inventory snapshots.

    assert.deepEqual(after, before);

    const persistedOrder =
      await prisma.order.findUnique({
        where: {
          code: orderCode,
        },
      });

    assert.equal(persistedOrder, null);

    const persistedOrderById =
      await prisma.order.findUnique({
        where: {
          id: evidence.orderId,
        },
      });

    assert.equal(persistedOrderById, null);

    const persistedItems =
      await prisma.orderItem.count({
        where: {
          OR: [
            {
              orderId: evidence.orderId,
            },
            {
              variantId: {
                in: variantIds,
              },
            },
          ],
        },
      });

    const persistedMovements =
      await prisma.inventoryMovement.count({
        where: {
          variantId: {
            in: variantIds,
          },
        },
      });

    const persistedEffects =
      await prisma.pendingInventoryEffect.count({
        where: {
          variantId: {
            in: variantIds,
          },
        },
      });

    assert.equal(persistedItems, 0);
    assert.equal(persistedMovements, 0);
    assert.equal(persistedEffects, 0);

    console.log('SKU-A final quantity:', after[0].quantity);
    console.log('SKU-B final quantity:', after[1].quantity);

    console.log('SKU-A final version:', after[0].version);
    console.log('SKU-B final version:', after[1].version);

    console.log('SKU-A sync state:', after[0].syncStatus);
    console.log('SKU-B sync state:', after[1].syncStatus);

    console.log('Persisted orders: 0');
    console.log('Persisted order items:', persistedItems);
    console.log('Persisted movements:', persistedMovements);
    console.log('Persisted pending effects:', persistedEffects);

    console.log('FULL INVENTORY SNAPSHOT PASS');

    console.log('\n========== MULTI-SKU ROLLBACK TEST PASS ==========');

    console.log('Test run:', tag);
    console.log('SKU-A variant ID:', variantAId);
    console.log('SKU-B variant ID:', variantBId);
    console.log('Rolled-back order ID:', evidence.orderId);
    console.log('Rolled-back order code:', orderCode);
    console.log('Partial stock deduction was rolled back');
    console.log('Order and order items were rolled back');
    console.log('Inventory movements were rolled back');
    console.log('Pending effects were rolled back');
    console.log('Test fixtures preserved for inspection');

  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('ROLLBACK SCRIPT TYPE CHECK PASS');
  console.log('No database connection opened');
  console.log('No database writes');
} else {
  main().catch((error: unknown) => {
    console.error(
      'ROLLBACK TEST FAILED:',
      errorCode(error),
    );

    if (
      error instanceof Error &&
      error.name === 'AssertionError'
    ) {
      console.error(error.message);
    }

    process.exitCode = 1;
  });
}
