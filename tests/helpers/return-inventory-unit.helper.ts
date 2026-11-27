import { HttpException } from '@nestjs/common';
import { DeliveryStatus, ReturnStatus, SyncState } from '@prisma/client';
import type { PreparedReturnReceipt } from '../../src/modules/inventory/return-inventory.service';
import type { VerifiedReturnEvidence } from '../../src/modules/inventory/return-inventory.contract';

export const RECEIPT_ID = 15;
const RECEIVED_AT = new Date('2020-01-01T00:00:00.000Z');

export function createCustomerFixtureData(resalableQuantity: number, kiotDocumentId: string | null) {
  const order = {
    id: 101,
    userId: 7,
    status: 'DELIVERED',
    deliveryStatus: DeliveryStatus.DELIVERED as DeliveryStatus,
  };
  const orderItem = { id: 201, orderId: 101, variantId: 301, quantity: 5 };
  const request = { orderId: 101, userId: 7, status: ReturnStatus.RECEIVED as ReturnStatus };
  const requestItem = { id: 401, requestId: 501, orderItemId: 201, quantity: 5, approvedQuantity: 5, orderItem };
  const item = { id: 601, receivedQuantity: 3, acceptedQuantity: 2, resalableQuantity, requestItem };
  const receipt = {
    id: RECEIPT_ID,
    requestId: 501,
    operationKey: 'RETURN-RECEIPT-15',
    actorId: 9,
    kiotDocumentId: kiotDocumentId,
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
  return { order, orderItem, request, requestItem, item, receipt, history };
}

export function createDeliveryFixtureData<T extends string | null>(
  f: ReturnType<typeof createCustomerFixtureData>,
  resalableQuantity: number,
  kiotDocumentId: T,
) {
  f.order.status = 'DELIVERY_UNSUCCESSFUL';
  f.order.deliveryStatus = DeliveryStatus.RETURNED;
  const item = { id: 701, orderItemId: f.orderItem.id, receivedQuantity: 3, resalableQuantity, orderItem: f.orderItem };
  const receipt = {
    id: RECEIPT_ID,
    orderId: f.order.id,
    sourceKey: 'DELIVERY-RECEIPT-15',
    actorId: null,
    kiotDocumentId,
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
  return { item, receipt, history };
}

export async function expectError(action: Promise<unknown>, status: number, code: string, message?: string): Promise<void> {
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

export function createVerifiedReturnFixtureData(observedAt: Date, updateMany: jest.Mock) {
  const receipt: PreparedReturnReceipt = {
    receiptKind: 'CUSTOMER_RETURN',
    receiptId: 15,
    receiptOperationKey: 'RETURN-15',
    orderId: 101,
    actorId: 9,
    sourceDocumentId: 'KV-RETURN-15',
    receivedAt: new Date('2020-01-02T00:00:00.000Z'),
    lines: [{
      receiptItemId: 601, orderItemId: 201, requestItemId: 401,
      variantId: 301, orderedQuantity: 5, receivedQuantity: 3,
      acceptedQuantity: 3, resalableQuantity: 3,
      operationKey: 'M03-RETURN-RECEIPT-ITEM-601-RESTOCK',
    }],
  };
  const evidence: VerifiedReturnEvidence = {
    receiptKind: 'CUSTOMER_RETURN', receiptId: 15,
    sourceDocumentId: 'KV-RETURN-15',
    snapshots: [{
      variantId: 301, sourceVariantId: 'KV-SKU-301',
      expectedInventoryVersion: 5, restockedQuantity: 3,
      sourceQuantity: 13, sourceVersion: 'source-v2',
      observedAt: new Date(observedAt), confirmedEffects: [], notReflectedEffects: [],
    }],
  };
  const inventory = {
    version: 5, quantity: 10, sourceVersion: 'source-v1',
    lastConfirmedAt: new Date('2020-01-01T00:00:00.000Z') as Date | null,
  };
  const mock = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 301 }]),
    productVariant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ kiotvietVariantId: 'KV-SKU-301' }) },
    inventory: { findUniqueOrThrow: jest.fn().mockResolvedValue(inventory), updateMany },
    returnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    deliveryReturnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    inventoryMovement: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
    pendingInventoryEffect: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
  };
  return { receipt, evidence, inventory, mock };
}

export function createPriorEffectFixtureData(delta: number) {
  const effect = {
    operationKey: 'ORDER-201-DEDUCT', variantId: 301, delta, version: 1,
    status: SyncState.PENDING as SyncState, releasedAt: null as Date | null,
    sourceDocumentId: null as string | null, sourceAcknowledgedAt: null as Date | null,
  };
  const movement = { operationKey: effect.operationKey, variantId: 301, delta, sourceDocumentId: null as string | null };
  return { effect, movement };
}
