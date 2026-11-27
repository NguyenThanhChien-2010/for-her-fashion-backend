import { HttpException } from '@nestjs/common';
import { InventoryReason, SyncState } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { InventoryLedgerService } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { ReturnInventoryService } from './return-inventory.service';
import type { PreparedReturnReceipt } from './return-inventory.service';
import type { VerifiedReturnEvidence } from './return-inventory.contract';

const OBSERVED_AT = new Date('2020-01-03T00:00:00.000Z');

function fixture() {
  const receipt: PreparedReturnReceipt = {
    receiptKind: 'CUSTOMER_RETURN', receiptId: 15,
    receiptOperationKey: 'RETURN-15', orderId: 101, actorId: 9,
    sourceDocumentId: 'KV-RETURN-15', receivedAt: new Date('2020-01-02T00:00:00.000Z'),
    lines: [{
      receiptItemId: 601, orderItemId: 201, requestItemId: 401,
      variantId: 301, orderedQuantity: 5, receivedQuantity: 3,
      acceptedQuantity: 3, resalableQuantity: 3,
      operationKey: 'M03-RETURN-RECEIPT-ITEM-601-RESTOCK',
    }],
  };
  const evidence: VerifiedReturnEvidence = {
    receiptKind: 'CUSTOMER_RETURN', receiptId: 15, sourceDocumentId: 'KV-RETURN-15',
    snapshots: [{
      variantId: 301, sourceVariantId: 'KV-SKU-301', expectedInventoryVersion: 5,
      restockedQuantity: 3, sourceQuantity: 13, sourceVersion: 'source-v2',
      observedAt: new Date(OBSERVED_AT), confirmedEffects: [], notReflectedEffects: [],
    }],
  };
  const movement = {
    id: 7001, operationKey: receipt.lines[0].operationKey, variantId: 301,
    delta: 3, reason: InventoryReason.RETURN_RECEIVED as InventoryReason,
    inventoryVersion: 6, note: null as string | null,
    refType: 'RETURN_RECEIPT_ITEM', refId: 601, createdBy: 9 as number | null,
    sourceDocumentId: 'KV-RETURN-15' as string | null,
  };
  const effect = {
    id: BigInt(8001), operationKey: movement.operationKey, variantId: 301,
    orderId: 101, delta: 3, status: SyncState.CONFIRMED as SyncState,
    version: 2, sourceDocumentId: 'KV-RETURN-15' as string | null,
    releasedAt: new Date(OBSERVED_AT) as Date | null,
    sourceAcknowledgedAt: new Date(OBSERVED_AT) as Date | null,
  };
  const movements = [movement];
  const effects = [effect];
  const mock = {
    $queryRaw: jest.fn(),
    productVariant: { findUniqueOrThrow: jest.fn() },
    inventory: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ version: 7, quantity: 11 }),
      findUnique: jest.fn(), updateMany: jest.fn(),
    },
    returnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    deliveryReturnReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    inventoryMovement: {
      findMany: jest.fn().mockResolvedValue(movements),
      findUnique: jest.fn().mockImplementation(async (args: { where: { operationKey: string } }) =>
        movements.find(row => row.operationKey === args.where.operationKey) ?? null),
      findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(),
    },
    pendingInventoryEffect: {
      findMany: jest.fn().mockResolvedValue(effects),
      findUnique: jest.fn().mockImplementation(async (args: { where: { operationKey: string } }) =>
        effects.find(row => row.operationKey === args.where.operationKey) ?? null),
      findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(),
    },
  };
  const ledger = new InventoryLedgerService();
  const pending = new PendingInventoryEffectService();
  const find = jest.spyOn(ledger, 'findRecordedOperation');
  const append = jest.spyOn(ledger, 'appendPendingMovement');
  const release = jest.spyOn(pending, 'releaseConfirmed');
  const service = new ReturnInventoryService(ledger, pending);
  const prepare = jest.spyOn(service, 'prepareReceipt').mockResolvedValue(receipt);
  const tx = mock as unknown as Prisma.TransactionClient;
  return { receipt, evidence, snapshot: evidence.snapshots[0], movement, effect,
    movements, effects, mock, service, tx, prepare, find, append, release };
}

type Fixture = ReturnType<typeof fixture>;

function apply(f: Fixture) {
  return f.service.applyVerifiedReturn(f.tx, f.receipt.receiptKind, f.receipt.receiptId, f.evidence);
}

function expectNoWrites(f: Fixture): void {
  expect(f.mock.$queryRaw).not.toHaveBeenCalled();
  expect(f.mock.productVariant.findUniqueOrThrow).not.toHaveBeenCalled();
  expect(f.mock.inventory.findUniqueOrThrow).not.toHaveBeenCalled();
  expect(f.mock.inventory.findUnique).not.toHaveBeenCalled();
  expect(f.mock.inventory.updateMany).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.create).not.toHaveBeenCalled();
  expect(f.mock.inventoryMovement.updateMany).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.create).not.toHaveBeenCalled();
  expect(f.mock.pendingInventoryEffect.updateMany).not.toHaveBeenCalled();
  expect(f.append).not.toHaveBeenCalled();
  expect(f.release).not.toHaveBeenCalled();
}

async function rejectReplay(f: Fixture): Promise<void> {
  try {
    await apply(f);
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'CONFLICT' });
    expectNoWrites(f);
    return;
  }
  throw new Error('Expected replay conflict');
}

function secondLine(f: Fixture, separateSku = false, recorded = true, quantity = 2): void {
  const line = {
    ...f.receipt.lines[0], receiptItemId: 602, orderItemId: 202, requestItemId: 402,
    variantId: separateSku ? 302 : 301, resalableQuantity: quantity,
    operationKey: 'M03-RETURN-RECEIPT-ITEM-602-RESTOCK',
  };
  f.receipt.lines.push(line);
  if (quantity === 0) return;
  if (separateSku) {
    f.evidence.snapshots.push({ ...f.snapshot, variantId: 302,
      sourceVariantId: 'KV-SKU-302', expectedInventoryVersion: 8,
      restockedQuantity: quantity, sourceQuantity: 12 });
  } else {
    f.snapshot.restockedQuantity += quantity;
    f.snapshot.sourceQuantity += quantity;
  }
  if (recorded) {
    f.movements.push({ ...f.movement, id: 7002, operationKey: line.operationKey,
      variantId: line.variantId, delta: quantity, refId: 602,
      inventoryVersion: separateSku ? 9 : 6 });
    f.effects.push({ ...f.effect, id: BigInt(8002), operationKey: line.operationKey,
      variantId: line.variantId, delta: quantity });
  }
}

describe('ReturnInventoryService - historical replay with real ledger validation', () => {
  it('RR-01: returns original movement and effect IDs without writes', async () => {
    const f = fixture();
    expect(await apply(f)).toEqual([{
      operationKey: f.movement.operationKey, variantId: 301, movementId: '7001',
      pendingEffectId: '8001', inventoryVersion: 6, delta: 3,
      receiptKind: 'CUSTOMER_RETURN', receiptItemId: 601, replayed: true,
    }]);
    expect(f.find).toHaveBeenCalledTimes(1);
    expectNoWrites(f);
  });
  it('RR-02: repeated replay ignores current inventory version and quantity', async () => {
    const f = fixture();
    const first = await apply(f);
    f.mock.inventory.findUniqueOrThrow.mockResolvedValue({ version: 99, quantity: 1 });
    expect(await apply(f)).toEqual(first);
    expect(f.find).toHaveBeenCalledTimes(2);
    expectNoWrites(f);
  });
  it('RR-03: replays all lines of one SKU', async () => {
    const f = fixture(); secondLine(f);
    const result = await apply(f);
    expect(result.map(r => [r.receiptItemId, r.delta, r.inventoryVersion, r.replayed]))
      .toEqual([[601, 3, 6, true], [602, 2, 6, true]]);
    expectNoWrites(f);
  });
  it('RR-04: replays multiple SKUs with their historical versions', async () => {
    const f = fixture(); secondLine(f, true);
    expect((await apply(f)).map(r => [r.variantId, r.inventoryVersion, r.replayed]))
      .toEqual([[301, 6, true], [302, 9, true]]);
    expectNoWrites(f);
  });
  it('RR-05: skips zero-resalable lines on a mixed receipt replay', async () => {
    const f = fixture(); secondLine(f, false, false, 0);
    expect(await apply(f)).toHaveLength(1);
    expectNoWrites(f);
  });
  it('RR-06: replays delivery return with nullable actor', async () => {
    const f = fixture();
    f.receipt.receiptKind = 'DELIVERY_RETURN'; f.evidence.receiptKind = 'DELIVERY_RETURN';
    f.receipt.actorId = null;
    const line = f.receipt.lines[0];
    line.requestItemId = null; line.acceptedQuantity = null;
    line.operationKey = 'M03-DELIVERY-RETURN-ITEM-601-RESTOCK';
    f.movement.operationKey = line.operationKey; f.effect.operationKey = line.operationKey;
    f.movement.refType = 'DELIVERY_RETURN_ITEM'; f.movement.createdBy = null;
    expect(await apply(f)).toEqual([expect.objectContaining({
      receiptKind: 'DELIVERY_RETURN', receiptItemId: 601, replayed: true,
    })]);
    expectNoWrites(f);
  });
  it('RR-07: rejects missing movement', async () => {
    const f = fixture(); f.movements.length = 0; await rejectReplay(f);
  });
  it('RR-08: rejects missing pending effect', async () => {
    const f = fixture(); f.effects.length = 0; await rejectReplay(f);
  });
  it('RR-09: rejects partially posted multi-SKU receipt', async () => {
    const f = fixture(); secondLine(f, true, false); await rejectReplay(f);
  });
  it('RR-10: rejects extra movement belonging to the same source document', async () => {
    const f = fixture(); f.movements.push({ ...f.movement, id: 7002,
      operationKey: 'M03-RETURN-RECEIPT-ITEM-999-RESTOCK' });
    await rejectReplay(f);
  });
  it('RR-11: rejects wrong operation key even if row counts match', async () => {
    const f = fixture(); f.movement.operationKey = 'OTHER-KEY'; await rejectReplay(f);
  });
  it('RR-12: rejects different movement source document', async () => {
    const f = fixture(); f.movement.sourceDocumentId = 'OTHER-DOC'; await rejectReplay(f);
  });
  it('RR-13: rejects different effect source document', async () => {
    const f = fixture(); f.effect.sourceDocumentId = 'OTHER-DOC'; await rejectReplay(f);
  });
  it('RR-14: rejects pending effect not confirmed', async () => {
    const f = fixture(); f.effect.status = SyncState.PENDING; await rejectReplay(f);
  });
  it('RR-15: rejects missing release timestamp', async () => {
    const f = fixture(); f.effect.releasedAt = null; await rejectReplay(f);
  });
  it('RR-16: rejects invalid release timestamp', async () => {
    const f = fixture(); f.effect.releasedAt = new Date(NaN); await rejectReplay(f);
  });
  it('RR-17: rejects missing acknowledgement timestamp', async () => {
    const f = fixture(); f.effect.sourceAcknowledgedAt = null; await rejectReplay(f);
  });
  it('RR-18: rejects different historical observation timestamp', async () => {
    const f = fixture(); f.snapshot.observedAt = new Date('2020-01-04T00:00:00Z');
    await rejectReplay(f);
  });
  it('RR-19: rejects different historical expected inventory version', async () => {
    const f = fixture(); f.snapshot.expectedInventoryVersion = 7; await rejectReplay(f);
  });
  it('RR-20: rejects changed receipt quantity via real ledger', async () => {
    const f = fixture(); f.receipt.lines[0].resalableQuantity = 2;
    f.snapshot.restockedQuantity = 2; await rejectReplay(f);
    expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-21: rejects different effect order ID via real ledger', async () => {
    const f = fixture(); f.effect.orderId = 999; await rejectReplay(f);
    expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-22: rejects different effect delta via real ledger', async () => {
    const f = fixture(); f.effect.delta = 2; await rejectReplay(f);
    expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-23: rejects different movement variant via real ledger', async () => {
    const f = fixture(); f.movement.variantId = 999; await rejectReplay(f);
    expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-24: rejects different movement reason via real ledger', async () => {
    const f = fixture(); f.movement.reason = InventoryReason.ORDER_CANCELLED;
    await rejectReplay(f); expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-25: rejects different receipt reference via real ledger', async () => {
    const f = fixture(); f.movement.refId = 999; await rejectReplay(f);
    expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-26: rejects different actor via real ledger', async () => {
    const f = fixture(); f.movement.createdBy = 999; await rejectReplay(f);
    expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-27: rejects source document owned by another customer receipt', async () => {
    const f = fixture(); f.mock.returnReceipt.findFirst.mockResolvedValue({ id: 99 });
    await rejectReplay(f); expect(f.find).not.toHaveBeenCalled();
  });
  it('RR-28: rejects source document owned by a delivery receipt', async () => {
    const f = fixture(); f.mock.deliveryReturnReceipt.findFirst.mockResolvedValue({ id: 99 });
    await rejectReplay(f); expect(f.find).not.toHaveBeenCalled();
  });
  it('RR-29: rejects pair disappearing during ledger identity read', async () => {
    const f = fixture(); f.mock.inventoryMovement.findUnique.mockResolvedValue(null);
    f.mock.pendingInventoryEffect.findUnique.mockResolvedValue(null);
    await rejectReplay(f); expect(f.find).toHaveBeenCalledTimes(1);
  });
  it('RR-30: replay does not reapply source quantity or version not stored in history', async () => {
    const f = fixture(); f.snapshot.sourceQuantity = 999; f.snapshot.sourceVersion = 'other-source-version';
    expect(await apply(f)).toEqual([expect.objectContaining({ inventoryVersion: 6, delta: 3, replayed: true })]);
    expectNoWrites(f);
  });
});
