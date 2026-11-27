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
      const code = (response as { code?: string }).code;

      return code ?? `HTTP_${error.getStatus()}`;
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

function isDeadlock(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return (
    error.code === 'P2034' ||
    (
      error.code === 'P2010' &&
      String(error.meta?.code) === '1213'
    )
  );
}

function createBarrier() {
  let arrivals = 0;
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals++;

    if (arrivals === 2) {
      release();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        gate,
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Concurrency barrier timeout')),
            5000,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}

async function verifyTarget(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<
    Array<{ databaseName: string; serverHost: string }>
  >`
    SELECT
      DATABASE() AS databaseName,
      @@hostname AS serverHost
  `;

  assert.equal(rows[0]?.databaseName, expectedDatabase);

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
    const userA = await tx.user.create({
      data: {
        email: `m03-${tag}-a@example.invalid`,
        fullName: 'M03 Test Customer A',
        passwordHash: 'NOT_A_LOGIN_PASSWORD',
      },
    });

    const userB = await tx.user.create({
      data: {
        email: `m03-${tag}-b@example.invalid`,
        fullName: 'M03 Test Customer B',
        passwordHash: 'NOT_A_LOGIN_PASSWORD',
      },
    });

    const category = await tx.category.create({
      data: {
        name: `M03 Test ${tag}`,
        slug: `m03-test-${tag}`,
      },
    });

    const colorGroup = await tx.colorGroup.create({
      data: {
        name: `M03 Group ${tag}`,
      },
    });

    const color = await tx.color.create({
      data: {
        groupId: colorGroup.id,
        name: `M03 Color ${tag}`,
        skuSuffix: `C${tag.slice(0, 8)}`,
        hex: '#000000',
      },
    });

    const sizeCode = `T${tag.slice(0, 8)}`;

    const size = await tx.size.create({
      data: {
        code: sizeCode,
        name: `M03 Size ${tag}`,
        skuSuffix: sizeCode,
      },
    });

    const product = await tx.product.create({
      data: {
        categoryId: category.id,
        name: `M03 Concurrency Product ${tag}`,
        slug: `m03-concurrency-${tag}`,
        baseCode: `M03-${tag}`,
        price: 100000,
        status: ProductStatus.ACTIVE,
      },
    });

    const variant = await tx.productVariant.create({
      data: {
        productId: product.id,
        colorId: color.id,
        sizeCode: size.code,
        sku: `M03-${tag}-${color.skuSuffix}-${size.skuSuffix}`,
        isActive: true,
      },
    });

    await tx.inventory.create({
      data: {
        variantId: variant.id,
        quantity: 1,
        sourceQuantity: 1,
        version: 1,
        syncStatus: SyncState.CONFIRMED,
        lastConfirmedAt: new Date(),
      },
    });

    return {
      userA,
      userB,
      product,
      variant,
      color,
      size,
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

  if (process.env.M03_RUN_CONCURRENCY !== 'YES') {
    throw new Error('Test execution not authorized');
  }

  const prisma = new PrismaService({
    datasources: {
      db: {
        url: `${url}?connection_limit=4`,
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

    const variantId = fixture.variant.id;

    const orderCodeA = `M03-${tag}-A`;
    const orderCodeB = `M03-${tag}-B`;

    console.log('Variant ID:', variantId);
    console.log('SKU:', fixture.variant.sku);
    console.log('Initial stock: 1');
    console.log('Initial version: 1');

    console.log('\n========== AVAILABILITY CHECK ==========');

    await Promise.all([
      service.assertAvailable([
        { variantId, quantity: 1 },
      ]),
      service.assertAvailable([
        { variantId, quantity: 1 },
      ]),
    ]);

    console.log('Both availability checks PASS');
    console.log('Availability check is not a reservation');

    const barrier = createBarrier();

    const connectionIds = new Set<string>();

    const retries = {
      A: 0,
      B: 0,
    };

    async function placeOrder(
      side: 'A' | 'B',
      userId: number,
      code: string,
    ) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              if (attempt === 1) {
                const rows = await tx.$queryRaw<
                  Array<{
                    connectionId: bigint;
                    isolationLevel: string;
                  }>
                >`
                  SELECT
                    CONNECTION_ID() AS connectionId,
                    @@transaction_isolation AS isolationLevel
                `;

                console.log(
                  'Session isolation:',
                  rows[0].isolationLevel,
                );

                const connectionId = String(
                  rows[0].connectionId,
                );

                connectionIds.add(connectionId);

                console.log(
                  `Transaction ${side}: connection=${connectionId}`,
                );

                await barrier();
              }

              const order = await tx.order.create({
                data: {
                  code,
                  userId,
                  status: 'AWAITING_CONFIRMATION',
                  paymentMethod: PaymentMethod.COD,
                  subtotal: 100000,
                  shippingFee: 0,
                  total: 100000,
                  shipName: `Test Customer ${side}`,
                  shipPhone: '0000000000',
                  shipEmail: `m03-${tag}-${side.toLowerCase()}@example.invalid`,
                  shipAddress: 'Integration test address',
                  shipProvince: 'Test province',
                  idempotencyKey: code,
                },
              });

              await tx.orderItem.create({
                data: {
                  orderId: order.id,
                  variantId,
                  productName: fixture.product.name,
                  sku: fixture.variant.sku,
                  colorName: fixture.color.name,
                  sizeCode: fixture.size.code,
                  unitPrice: 100000,
                  quantity: 1,
                  lineTotal: 100000,
                  netAmount: 100000,
                },
              });

              const result = await service.deductForOrder(
                tx,
                order.id,
              );

              return {
                orderId: order.id,
                result,
              };
            },
            txOptions,
          );
        } catch (error) {
          console.log(
            `Transaction ${side}, attempt ${attempt}: ${errorCode(error)}`,
          );

          if (isDeadlock(error) && attempt < 3) {
            retries[side]++;

            console.log(
              `Transaction ${side}: retrying entire transaction`,
            );

            await new Promise((resolve) => {
              setTimeout(resolve, 100 * attempt);
            });

            continue;
          }

          throw error;
        }
      }

      throw new Error('Transaction retry limit exceeded');
    }

    console.log('\n========== CONCURRENT ORDERS ==========');

    const outcomes = await Promise.allSettled([
      placeOrder('A', fixture.userA.id, orderCodeA),
      placeOrder('B', fixture.userB.id, orderCodeB),
    ]);

    console.log('Distinct connections:', connectionIds.size);
    console.log('Deadlock retries A:', retries.A);
    console.log('Deadlock retries B:', retries.B);

    assert.equal(connectionIds.size, 2);

    const fulfilledCount = outcomes.filter(
      (item) => item.status === 'fulfilled',
    ).length;

    const rejectedCount = outcomes.filter(
      (item) => item.status === 'rejected',
    ).length;

    console.log('Successful orders:', fulfilledCount);
    console.log('Rejected orders:', rejectedCount);

    assert.equal(fulfilledCount, 1);
    assert.equal(rejectedCount, 1);

    const winner = outcomes.find(
      (item) => item.status === 'fulfilled',
    );

    const loser = outcomes.find(
      (item) => item.status === 'rejected',
    );

    assert.ok(winner && winner.status === 'fulfilled');
    assert.ok(loser && loser.status === 'rejected');

    const rejectedCode = errorCode(loser.reason);

    console.log('Rejected order code:', rejectedCode);

    assert.equal(rejectedCode, 'INSUFFICIENT_STOCK');

    assert.ok(loser.reason instanceof HttpException);
    assert.equal(loser.reason.getStatus(), 409);

    const winnerOrderId = winner.value.orderId;

    const operationKey =
      `M03-ORDER-${winnerOrderId}-SKU-${variantId}-DEDUCT`;

    assert.equal(winner.value.result.length, 1);
    assert.equal(winner.value.result[0].delta, -1);
    assert.equal(winner.value.result[0].replayed, false);

    console.log('\n========== DATABASE VERIFICATION ==========');

    async function verifyFinalState() {
      const inventory =
        await prisma.inventory.findUniqueOrThrow({
          where: { variantId },
        });

      const orders = await prisma.order.findMany({
        where: {
          code: {
            in: [orderCodeA, orderCodeB],
          },
        },
        include: {
          items: true,
        },
      });

      const items = await prisma.orderItem.findMany({
        where: { variantId },
      });

      const movements =
        await prisma.inventoryMovement.findMany({
          where: { variantId },
        });

      const effects =
        await prisma.pendingInventoryEffect.findMany({
          where: { variantId },
        });

      console.log('Inventory quantity:', inventory.quantity);
      console.log('Inventory version:', inventory.version);
      console.log('Source quantity:', inventory.sourceQuantity);
      console.log('Sync state:', inventory.syncStatus);
      console.log('Persisted orders:', orders.length);
      console.log('Persisted order items:', items.length);
      console.log('Inventory movements:', movements.length);
      console.log('Pending effects:', effects.length);

      assert.equal(inventory.quantity, 0);
      assert.equal(inventory.version, 2);
      assert.equal(inventory.sourceQuantity, 1);
      assert.equal(inventory.syncStatus, SyncState.PENDING);

      assert.equal(orders.length, 1);
      assert.equal(orders[0].id, winnerOrderId);
      assert.equal(orders[0].items.length, 1);

      assert.equal(items.length, 1);
      assert.equal(items[0].orderId, winnerOrderId);
      assert.equal(items[0].quantity, 1);

      assert.equal(movements.length, 1);
      assert.equal(movements[0].operationKey, operationKey);
      assert.equal(movements[0].delta, -1);
      assert.equal(
        movements[0].reason,
        InventoryReason.ORDER_CREATED,
      );
      assert.equal(movements[0].refType, 'ORDER');
      assert.equal(movements[0].refId, winnerOrderId);
      assert.equal(movements[0].inventoryVersion, 2);

      assert.equal(effects.length, 1);
      assert.equal(effects[0].operationKey, operationKey);
      assert.equal(effects[0].orderId, winnerOrderId);
      assert.equal(effects[0].delta, -1);
      assert.equal(effects[0].status, SyncState.PENDING);
      assert.equal(effects[0].releasedAt, null);

      console.log('DATABASE STATE PASS');
    }

    await verifyFinalState();

    console.log('\n========== IDEMPOTENCY REPLAY ==========');

    const replay = await prisma.$transaction(
      (tx) => service.deductForOrder(tx, winnerOrderId),
      txOptions,
    );

    assert.equal(replay.length, 1);
    assert.equal(replay[0].replayed, true);
    assert.equal(replay[0].operationKey, operationKey);

    assert.equal(
      replay[0].movementId,
      winner.value.result[0].movementId,
    );

    assert.equal(
      replay[0].pendingEffectId,
      winner.value.result[0].pendingEffectId,
    );

    await verifyFinalState();

    console.log('IDEMPOTENCY REPLAY PASS');

    console.log('\n========== CONCURRENCY TEST PASS ==========');
    console.log('Test run:', tag);
    console.log('Winner order ID:', winnerOrderId);
    console.log('Variant ID:', variantId);
    console.log('No overselling detected in this test run');
    console.log('Test fixtures preserved for inspection');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes('--check-only')) {
  console.log('CONCURRENCY SCRIPT TYPE CHECK PASS');
  console.log('No database connection opened');
  console.log('No database writes');
} else {
  main().catch((error: unknown) => {
    console.error('CONCURRENCY TEST FAILED:', errorCode(error));

    if (
      error instanceof Error &&
      error.name === 'AssertionError'
    ) {
      console.error(error.message);
    }

    process.exitCode = 1;
  });
}
