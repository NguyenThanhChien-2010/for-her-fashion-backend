import { RECEIPT_ID, createCustomerFixtureData, createDeliveryFixtureData, expectError } from '../../../tests/helpers/return-inventory-unit.helper';
import { DeliveryStatus, ReturnStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { InventoryLedgerService } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { ReturnInventoryService } from './return-inventory.service';
import type { ReturnReceiptKind } from './return-inventory.contract';


function customerFixture() {
  const { order, orderItem, request, requestItem, item, receipt, history } = createCustomerFixtureData(1, 'KV-RETURN-15');
  const mock = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    returnReceipt: {
      findUnique: jest.fn().mockResolvedValue({ requestId: 501, request: { orderId: 101 } }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(receipt),
    },
    deliveryReturnReceipt: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    returnReceiptItem: { findMany: jest.fn().mockImplementation(async () => [history()]) },
    deliveryReturnItem: { findMany: jest.fn().mockResolvedValue([]) },
    inventory: { update: jest.fn(), updateMany: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    pendingInventoryEffect: { create: jest.fn(), updateMany: jest.fn() },
  };
  const service = new ReturnInventoryService(new InventoryLedgerService(), new PendingInventoryEffectService());
  const tx = mock as unknown as Prisma.TransactionClient;
  return { order, orderItem, request, requestItem, item, receipt, history, mock, service, tx };
}

function deliveryFixture() {
  const f = customerFixture();
  const { item, receipt, history } = createDeliveryFixtureData<string>(f, 2, 'KV-DELIVERY-15');
  f.mock.deliveryReturnReceipt.findUnique.mockResolvedValue({ orderId: f.order.id });
  f.mock.deliveryReturnReceipt.findUniqueOrThrow.mockResolvedValue(receipt);
  f.mock.returnReceiptItem.findMany.mockResolvedValue([]);
  f.mock.deliveryReturnItem.findMany.mockImplementation(async () => [history()]);
  return { ...f, deliveryItem: item, deliveryReceipt: receipt, deliveryHistory: history };
}


function prepare(f: ReturnType<typeof customerFixture>, kind: ReturnReceiptKind = 'CUSTOMER_RETURN') {
  return f.service.prepareReceipt(f.tx, kind, RECEIPT_ID);
}

function expectNoWrites(f: ReturnType<typeof customerFixture>): void {
  expect(f.mock.inventory.update).not.toHaveBeenCalled();
  expect(f.mock.inventory.updateMany).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.create).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.create).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.updateMany).not.toHaveBeenCalled();
}

describe('ReturnInventoryService - receipt preparation and cumulative quantities', () => {
  it('RP-01: prepares customer receipt without writing stock', async () => {
    const f = customerFixture();
    const result = await prepare(f);
    expect(result).toMatchObject({ receiptKind: 'CUSTOMER_RETURN', receiptId: 15, orderId: 101, sourceDocumentId: 'KV-RETURN-15' });
    expect(result.lines).toEqual([{ receiptItemId: 601, orderItemId: 201, requestItemId: 401, variantId: 301, orderedQuantity: 5, receivedQuantity: 3, acceptedQuantity: 2, resalableQuantity: 1, operationKey: 'M03-RETURN-RECEIPT-ITEM-601-RESTOCK' }]);
    expectNoWrites(f);
  });

  it('RP-02: prepares failed delivery receipt without writing stock', async () => {
    const f = deliveryFixture();
    const result = await prepare(f, 'DELIVERY_RETURN');
    expect(result).toMatchObject({ receiptKind: 'DELIVERY_RETURN', receiptId: 15, orderId: 101, actorId: null, sourceDocumentId: 'KV-DELIVERY-15' });
    expect(result.lines).toEqual([{ receiptItemId: 701, orderItemId: 201, requestItemId: null, variantId: 301, orderedQuantity: 5, receivedQuantity: 3, acceptedQuantity: null, resalableQuantity: 2, operationKey: 'M03-DELIVERY-RETURN-ITEM-701-RESTOCK' }]);
    expectNoWrites(f);
  });

  it('RP-03: requests order, request and receipt locks in sequence', async () => {
    const f = customerFixture();
    await prepare(f);
    const queries = f.mock.$queryRaw.mock.calls.map(call => (call[0] as TemplateStringsArray).join('?'));
    expect(queries).toHaveLength(3);
    expect(queries[0]).toMatch(/FROM orders\s+WHERE id = \?\s+FOR UPDATE/);
    expect(queries[1]).toMatch(/FROM return_requests\s+WHERE id = \?\s+FOR UPDATE/);
    expect(queries[2]).toMatch(/FROM return_receipts\s+WHERE id = \?\s+FOR UPDATE/);
    expect(f.mock.$queryRaw.mock.calls.map(call => call[1])).toEqual([101, 501, 15]);
  });

  it('RP-04: requests order then delivery receipt lock', async () => {
    const f = deliveryFixture();
    await prepare(f, 'DELIVERY_RETURN');
    const queries = f.mock.$queryRaw.mock.calls.map(call => (call[0] as TemplateStringsArray).join('?'));
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('FROM orders');
    expect(queries[1]).toMatch(/FROM delivery_return_receipts\s+WHERE id = \?\s+FOR UPDATE/);
    expect(f.mock.$queryRaw.mock.calls.map(call => call[1])).toEqual([101, 15]);
  });

  it('RP-05: rejects invalid receipt ID before accessing database', async () => {
    const f = customerFixture();
    await expectError(f.service.prepareReceipt(f.tx, 'CUSTOMER_RETURN', 0), 400, 'VALIDATION_ERROR');
    expect(f.mock.returnReceipt.findUnique).not.toHaveBeenCalled();
    expect(f.mock.$queryRaw).not.toHaveBeenCalled();
  });

  it('RP-06: rejects unknown receipt kind', async () => {
    const f = customerFixture();
    await expectError(prepare(f, 'UNKNOWN' as ReturnReceiptKind), 400, 'VALIDATION_ERROR');
    expect(f.mock.$queryRaw).not.toHaveBeenCalled();
  });

  it('RP-07: rejects missing customer receipt', async () => {
    const f = customerFixture();
    f.mock.returnReceipt.findUnique.mockResolvedValue(null);
    await expectError(prepare(f), 404, 'NOT_FOUND');
  });

  it('RP-08: rejects missing delivery receipt', async () => {
    const f = deliveryFixture();
    f.mock.deliveryReturnReceipt.findUnique.mockResolvedValue(null);
    await expectError(prepare(f, 'DELIVERY_RETURN'), 404, 'NOT_FOUND');
  });

  it('RP-09: rejects missing original order', async () => {
    const f = customerFixture();
    f.mock.$queryRaw.mockResolvedValueOnce([]);
    await expectError(prepare(f), 404, 'NOT_FOUND');
    expect(f.mock.order.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('RP-10: rejects customer return before delivery', async () => {
    const f = customerFixture();
    f.order.deliveryStatus = DeliveryStatus.IN_TRANSIT;
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-11: rejects approved but not received request', async () => {
    const f = customerFixture();
    f.request.status = ReturnStatus.APPROVED;
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-12: accepts completed return request', async () => {
    const f = customerFixture();
    f.request.status = ReturnStatus.COMPLETED;
    expect((await prepare(f)).lines).toHaveLength(1);
  });

  it('RP-13: rejects failed delivery still returning', async () => {
    const f = deliveryFixture();
    f.order.deliveryStatus = DeliveryStatus.RETURNING;
    await expectError(prepare(f, 'DELIVERY_RETURN'), 409, 'CONFLICT');
  });

  it('RP-14: rejects mismatched customer ownership', async () => {
    const f = customerFixture();
    f.request.userId = 99;
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-15: rejects receipt item linked to another order', async () => {
    const f = customerFixture();
    f.orderItem.orderId = 999;
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-16: rejects receipt item linked to another request', async () => {
    const f = customerFixture();
    f.requestItem.requestId = 999;
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-17: rejects received quantity above original purchase', async () => {
    const f = customerFixture();
    f.item.receivedQuantity = 6;
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-18: rejects accepted quantity above approval', async () => {
    const f = customerFixture();
    f.requestItem.approvedQuantity = 1;
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-19: rejects resalable quantity above accepted quantity', async () => {
    const f = customerFixture();
    f.item.resalableQuantity = 3;
    await expectError(prepare(f), 400, 'VALIDATION_ERROR');
  });

  it('RP-20: rejects empty receipt', async () => {
    const f = customerFixture();
    f.receipt.items = [];
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-21: rejects receipt with no physical goods received', async () => {
    const f = customerFixture();
    Object.assign(f.item, { receivedQuantity: 0, acceptedQuantity: 0, resalableQuantity: 0 });
    await expectError(prepare(f), 409, 'CONFLICT');
  });

  it('RP-22: accepts physical goods with no resalable quantity', async () => {
    const f = customerFixture();
    f.item.resalableQuantity = 0;
    expect((await prepare(f)).lines[0].resalableQuantity).toBe(0);
    expectNoWrites(f);
  });

  it('RP-23: accepts cumulative accepted quantity exactly at approved limit', async () => {
    const f = customerFixture();
    const previous = { ...f.history(), id: 602, receiptId: 16, receivedQuantity: 3, acceptedQuantity: 3, resalableQuantity: 2 };
    f.mock.returnReceiptItem.findMany.mockResolvedValue([previous, f.history()]);
    expect((await prepare(f)).lines).toHaveLength(1);
    expectNoWrites(f);
  });

  it('RP-24: rejects cumulative accepted quantity above approved limit', async () => {
    const f = customerFixture();
    f.requestItem.approvedQuantity = 3;
    const previous = { ...f.history(), id: 602, receiptId: 16, receivedQuantity: 2, acceptedQuantity: 2, resalableQuantity: 1 };
    f.mock.returnReceiptItem.findMany.mockResolvedValue([previous, f.history()]);
    await expectError(prepare(f), 409, 'CONFLICT', 'Số lượng hoàn hàng cộng dồn vượt giới hạn.');
  });

  it('RP-25: rejects cumulative accepted quantity across different requests', async () => {
    const f = customerFixture();
    const history = f.history();
    const previous = { ...history, id: 602, receiptId: 16, receivedQuantity: 4, acceptedQuantity: 4, resalableQuantity: 3, receipt: { requestId: 502 }, requestItem: { ...history.requestItem, id: 402, requestId: 502 } };
    f.mock.returnReceiptItem.findMany.mockResolvedValue([previous, history]);
    await expectError(prepare(f), 409, 'CONFLICT', 'Số lượng hoàn hàng cộng dồn vượt giới hạn.');
  });

  it('RP-26: rejects cumulative quantity across customer and delivery returns', async () => {
    const f = customerFixture();
    f.mock.deliveryReturnItem.findMany.mockResolvedValue([{ id: 701, receiptId: 30, orderItemId: 201, receivedQuantity: 4, resalableQuantity: 1, receipt: { orderId: 101 } }]);
    await expectError(prepare(f), 409, 'CONFLICT', 'Số lượng hoàn hàng cộng dồn vượt giới hạn.');
  });

  it('RP-27: rejects cumulative delivery receipt quantity above purchase', async () => {
    const f = deliveryFixture();
    const previous = { ...f.deliveryHistory(), id: 702, receiptId: 16, receivedQuantity: 3, resalableQuantity: 1 };
    f.mock.deliveryReturnItem.findMany.mockResolvedValue([previous, f.deliveryHistory()]);
    await expectError(prepare(f, 'DELIVERY_RETURN'), 409, 'CONFLICT', 'Số lượng hoàn hàng cộng dồn vượt giới hạn.');
  });

  it('RP-28: rejects missing current receipt line in history', async () => {
    const f = customerFixture();
    f.mock.returnReceiptItem.findMany.mockResolvedValue([]);
    await expectError(prepare(f), 409, 'CONFLICT', 'Không tìm thấy đầy đủ chi tiết kiểm nhận hiện tại.');
  });

  it('RP-29: rejects inconsistent current receipt classification in history', async () => {
    const f = customerFixture();
    f.mock.returnReceiptItem.findMany.mockResolvedValue([{ ...f.history(), resalableQuantity: 0 }]);
    await expectError(prepare(f), 409, 'CONFLICT', 'Chi tiết kiểm nhận đã thay đổi hoặc không nhất quán.');
  });

  it('RP-30: rejects duplicate current line in history', async () => {
    const f = customerFixture();
    f.mock.returnReceiptItem.findMany.mockResolvedValue([f.history(), f.history()]);
    await expectError(prepare(f), 409, 'CONFLICT', 'Chi tiết kiểm nhận đã thay đổi hoặc không nhất quán.');
    expectNoWrites(f);
  });
});
