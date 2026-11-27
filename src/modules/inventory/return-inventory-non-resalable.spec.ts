import { HttpException } from '@nestjs/common';
import { DeliveryStatus, InventoryReason, ReturnStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { InventoryLedgerService } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { ReturnInventoryService } from './return-inventory.service';
import type { ReturnReceiptKind, VerifiedReturnEvidence } from './return-inventory.contract';

const RECEIPT_ID = 15;
const RECEIVED_AT = new Date('2020-01-01T00:00:00.000Z');

function customerFixture() {
  const order = {
    id: 101,
    userId: 7,
    status: 'DELIVERED',
    deliveryStatus: DeliveryStatus.DELIVERED as DeliveryStatus,
  };
  const orderItem = { id: 201, orderId: 101, variantId: 301, quantity: 5 };
  const request = { orderId: 101, userId: 7, status: ReturnStatus.RECEIVED as ReturnStatus };
  const requestItem = { id: 401, requestId: 501, orderItemId: 201, quantity: 5, approvedQuantity: 5, orderItem };
  const item = { id: 601, receivedQuantity: 3, acceptedQuantity: 2, resalableQuantity: 0, requestItem };
  const receipt = {
    id: RECEIPT_ID,
    requestId: 501,
    operationKey: 'RETURN-RECEIPT-15',
    actorId: 9,
    kiotDocumentId: null as string | null,
    receivedAt: new Date(RECEIVED_AT),
    request,
    items: [item],
  };
  const history = () => ({
    id: item.id,
    receiptId: receipt.id,
    receivedQuantity: item.receivedQuantity,
    acceptedQuantity: item.acceptedQuantity,
    resalableQuantity: item.resalableQuantity,
    receipt: { requestId: receipt.requestId },
    requestItem: {
      id: requestItem.id,
      requestId: requestItem.requestId,
      orderItemId: requestItem.orderItemId,
      quantity: requestItem.quantity,
      approvedQuantity: requestItem.approvedQuantity,
      request: { orderId: request.orderId },
    },
  });
  const mock = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    returnReceipt: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ requestId: 501, request: { orderId: 101 } }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(receipt),
    },
    deliveryReturnReceipt: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    returnReceiptItem: { findMany: jest.fn().mockImplementation(async () => [history()]) },
    deliveryReturnItem: { findMany: jest.fn().mockResolvedValue([]) },
    productVariant: { findUniqueOrThrow: jest.fn() },
    inventory: { findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    inventoryMovement: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    pendingInventoryEffect: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  };
  const ledger = new InventoryLedgerService();
  const pending = new PendingInventoryEffectService();
  const append = jest.spyOn(ledger, 'appendPendingMovement');
  const find = jest.spyOn(ledger, 'findRecordedOperation');
  const release = jest.spyOn(pending, 'releaseConfirmed');
  const service = new ReturnInventoryService(ledger, pending);
  const tx = mock as unknown as Prisma.TransactionClient;
  return { order, orderItem, request, requestItem, item, receipt, history, mock, service, tx, append, find, release };
}

function deliveryFixture() {
  const f = customerFixture();
  f.order.status = 'DELIVERY_UNSUCCESSFUL';
  f.order.deliveryStatus = DeliveryStatus.RETURNED;
  const item = { id: 701, orderItemId: f.orderItem.id, receivedQuantity: 3, resalableQuantity: 0, orderItem: f.orderItem };
  const receipt = {
    id: RECEIPT_ID,
    orderId: f.order.id,
    sourceKey: 'DELIVERY-RECEIPT-15',
    actorId: null,
    kiotDocumentId: 'KV-DELIVERY-15' as string | null,
    receivedAt: new Date(RECEIVED_AT),
    items: [item],
  };
  const history = () => ({
    id: item.id,
    receiptId: receipt.id,
    orderItemId: item.orderItemId,
    receivedQuantity: item.receivedQuantity,
    resalableQuantity: item.resalableQuantity,
    receipt: { orderId: receipt.orderId },
  });
  f.mock.deliveryReturnReceipt.findUnique.mockResolvedValue({ orderId: f.order.id });
  f.mock.deliveryReturnReceipt.findUniqueOrThrow.mockResolvedValue(receipt);
  f.mock.returnReceiptItem.findMany.mockResolvedValue([]);
  f.mock.deliveryReturnItem.findMany.mockImplementation(async () => [history()]);
  return { ...f, deliveryItem: item, deliveryReceipt: receipt, deliveryHistory: history };
}

async function expectError(action: Promise<unknown>, status: number, code: string, message?: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
    if (message !== undefined) expect(error.getResponse()).toMatchObject({ message });
    return;
  }
  throw new Error(`Expected ${code} was not thrown`);
}

function validate(f: ReturnType<typeof customerFixture>, kind: ReturnReceiptKind = 'CUSTOMER_RETURN') {
  return f.service.validateNonResalableReturn(f.tx, kind, RECEIPT_ID);
}

function expectNoWrites(f: ReturnType<typeof customerFixture>): void {
  expect(f.mock.productVariant.findUniqueOrThrow).not.toHaveBeenCalled();
  expect(f.mock.inventory.findUniqueOrThrow).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.findMany).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.findMany).not.toHaveBeenCalled();
  expect(f.append).not.toHaveBeenCalled();
  expect(f.find).not.toHaveBeenCalled();
  expect(f.release).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.updateMany).not.toHaveBeenCalled();
  expect(f.mock.inventory.update).not.toHaveBeenCalled();
  expect(f.mock.inventory.updateMany).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.create).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.create).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.updateMany).not.toHaveBeenCalled();
}

type Fixture = ReturnType<typeof customerFixture>;

function evidence(kind: ReturnReceiptKind = 'CUSTOMER_RETURN'): VerifiedReturnEvidence {
  return {
    receiptKind: kind,
    receiptId: RECEIPT_ID,
    sourceDocumentId: kind === 'CUSTOMER_RETURN' ? 'KV-RETURN-15' : 'KV-DELIVERY-15',
    snapshots: [],
  };
}

function apply(f: Fixture, input = evidence()) {
  return f.service.applyVerifiedReturn(f.tx, input.receiptKind, RECEIPT_ID, input);
}

async function rejectNoChange(f: Fixture, action: Promise<unknown> = validate(f)): Promise<void> {
  await expectError(action, 409, 'CONFLICT');
  expectNoWrites(f);
}

describe('ReturnInventoryService - non-resalable returns', () => {
  it('NR-01: returns NO_STOCK_CHANGE for unlinked customer receipt', async () => {
    const f = customerFixture();
    expect(await validate(f)).toEqual({ receiptKind: 'CUSTOMER_RETURN', receiptId: 15, orderId: 101, outcome: 'NO_STOCK_CHANGE', restockedQuantity: 0 });
    expect(f.mock.returnReceipt.findFirst).not.toHaveBeenCalled();
    expect(f.mock.deliveryReturnReceipt.findFirst).not.toHaveBeenCalled();
    expectNoWrites(f);
  });
  it('NR-02: validates linked customer receipt without writing inventory', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = 'KV-RETURN-15';
    expect(await validate(f)).toMatchObject({ outcome: 'NO_STOCK_CHANGE', restockedQuantity: 0 });
    expect(f.mock.returnReceipt.findFirst).toHaveBeenCalledWith({ where: { kiotDocumentId: 'KV-RETURN-15', id: { not: 15 } }, select: { id: true } });
    expect(f.mock.deliveryReturnReceipt.findFirst).toHaveBeenCalledWith({ where: { kiotDocumentId: 'KV-RETURN-15' }, select: { id: true } });
    expectNoWrites(f);
  });
  it('NR-03: validates delivery return and excludes its own receipt from ownership search', async () => {
    const f = deliveryFixture();
    expect(await validate(f, 'DELIVERY_RETURN')).toEqual({ receiptKind: 'DELIVERY_RETURN', receiptId: 15, orderId: 101, outcome: 'NO_STOCK_CHANGE', restockedQuantity: 0 });
    expect(f.mock.deliveryReturnReceipt.findFirst).toHaveBeenCalledWith({ where: { kiotDocumentId: 'KV-DELIVERY-15', id: { not: 15 } }, select: { id: true } });
    expectNoWrites(f);
  });
  it('NR-04: repeated no-stock validation never writes stock', async () => {
    const f = customerFixture();
    expect(await validate(f)).toEqual(await validate(f));
    expect(f.mock.inventoryMovement.findFirst).toHaveBeenCalledTimes(2);
    expect(f.mock.pendingInventoryEffect.findFirst).toHaveBeenCalledTimes(2);
    expectNoWrites(f);
  });
  it('NR-05: accepts physical goods even if accepted quantity is zero', async () => {
    const f = customerFixture(); f.item.acceptedQuantity = 0;
    expect(await validate(f)).toMatchObject({ outcome: 'NO_STOCK_CHANGE' }); expectNoWrites(f);
  });
  it('NR-06: rejects customer receipt containing resalable goods', async () => {
    const f = customerFixture(); f.item.resalableQuantity = 1;
    await rejectNoChange(f);
    expect(f.mock.inventoryMovement.findFirst).not.toHaveBeenCalled();
  });
  it('NR-07: rejects delivery receipt containing resalable goods', async () => {
    const f = deliveryFixture(); f.deliveryItem.resalableQuantity = 1;
    await rejectNoChange(f, validate(f, 'DELIVERY_RETURN'));
  });
  it('NR-08: rejects empty source document on linked customer receipt', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = '';
    await rejectNoChange(f);
  });
  it('NR-09: rejects malformed source document with surrounding whitespace', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = ' KV-RETURN-15 ';
    await rejectNoChange(f);
  });
  it('NR-10: rejects overlong source document', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = 'x'.repeat(101);
    await rejectNoChange(f);
  });
  it('NR-11: rejects delivery receipt missing mandatory source document', async () => {
    const f = deliveryFixture(); f.deliveryReceipt.kiotDocumentId = null;
    await rejectNoChange(f, validate(f, 'DELIVERY_RETURN'));
  });
  it('NR-12: rejects document owned by another customer receipt', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = 'KV-RETURN-15';
    f.mock.returnReceipt.findFirst.mockResolvedValue({ id: 16 });
    await rejectNoChange(f);
  });
  it('NR-13: rejects document owned by another delivery receipt', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = 'KV-RETURN-15';
    f.mock.deliveryReturnReceipt.findFirst.mockResolvedValue({ id: 16 });
    await rejectNoChange(f);
  });
  it('NR-14: rejects existing movement and searches by both key and receipt reference', async () => {
    const f = customerFixture(); f.mock.inventoryMovement.findFirst.mockResolvedValue({ id: 7001 });
    await rejectNoChange(f);
    expect(f.mock.inventoryMovement.findFirst).toHaveBeenCalledWith({ where: { OR: [{ operationKey: { in: ['M03-RETURN-RECEIPT-ITEM-601-RESTOCK'] } }, { refType: 'RETURN_RECEIPT_ITEM', refId: { in: [601] } }] }, select: { id: true } });
  });
  it('NR-15: rejects existing pending effect even when movement is missing', async () => {
    const f = customerFixture(); f.mock.pendingInventoryEffect.findFirst.mockResolvedValue({ id: BigInt(8001) });
    await rejectNoChange(f);
    expect(f.mock.pendingInventoryEffect.findFirst).toHaveBeenCalledWith({ where: { operationKey: { in: ['M03-RETURN-RECEIPT-ITEM-601-RESTOCK'] } }, select: { id: true } });
  });
  it('NR-16: also searches return movement by source document and delivery reference', async () => {
    const f = deliveryFixture();
    f.mock.inventoryMovement.findFirst.mockResolvedValue({ id: 7001 });
    await rejectNoChange(f, validate(f, 'DELIVERY_RETURN'));
    expect(f.mock.inventoryMovement.findFirst).toHaveBeenCalledWith({ where: { OR: [{ operationKey: { in: ['M03-DELIVERY-RETURN-ITEM-701-RESTOCK'] } }, { refType: 'DELIVERY_RETURN_ITEM', refId: { in: [701] } }, { reason: InventoryReason.RETURN_RECEIVED, sourceDocumentId: 'KV-DELIVERY-15' }] }, select: { id: true } });
  });
  it('NR-17: rejects receipt with no physical goods received', async () => {
    const f = customerFixture(); f.item.receivedQuantity = 0; f.item.acceptedQuantity = 0;
    await rejectNoChange(f);
  });
  it('NR-18: verified zero-resalable customer receipt returns empty movements', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = 'KV-RETURN-15';
    expect(await apply(f)).toEqual([]); expectNoWrites(f);
    expect(f.mock.inventoryMovement.findFirst).toHaveBeenCalledTimes(1);
  });
  it('NR-19: verified zero-resalable delivery receipt returns empty movements', async () => {
    const f = deliveryFixture();
    expect(await apply(f, evidence('DELIVERY_RETURN'))).toEqual([]); expectNoWrites(f);
  });
  it('NR-20: verified path still rejects historical pending effect on zero-resalable receipt', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = 'KV-RETURN-15';
    f.mock.pendingInventoryEffect.findFirst.mockResolvedValue({ id: BigInt(8001) });
    await rejectNoChange(f, apply(f));
  });
  it('NR-21: verified path rejects unlinked source even for zero-resalable receipt', async () => {
    const f = customerFixture();
    await rejectNoChange(f, apply(f));
    expect(f.mock.inventoryMovement.findFirst).not.toHaveBeenCalled();
  });
  it('NR-22: verified path rejects positive snapshot for zero-resalable receipt', async () => {
    const f = customerFixture(); f.receipt.kiotDocumentId = 'KV-RETURN-15';
    const input = evidence();
    input.snapshots.push({ variantId: 301, sourceVariantId: 'KV-SKU-301', expectedInventoryVersion: 5, restockedQuantity: 1, sourceQuantity: 11, sourceVersion: 'v2', observedAt: new Date('2020-01-02T00:00:00.000Z'), confirmedEffects: [], notReflectedEffects: [] });
    await rejectNoChange(f, apply(f, input));
    expect(f.mock.inventoryMovement.findFirst).not.toHaveBeenCalled();
  });
});
