import { HttpException } from '@nestjs/common';

import { InventoryLedgerService } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { ReturnInventoryService } from './return-inventory.service';
import type { PreparedReturnReceipt } from './return-inventory.service';
import type {
  VerifiedReturnEvidence,
  VerifiedReturnSourceSnapshot,
} from './return-inventory.contract';

const MAX_INT = 2147483647;
const RECEIVED_AT = new Date('2020-01-01T00:00:00.000Z');
const OBSERVED_AT = new Date('2020-01-02T00:00:00.000Z');

function snapshot(variantId = 301, restockedQuantity = 2): VerifiedReturnSourceSnapshot {
  return {
    variantId,
    sourceVariantId: `KV-SKU-${variantId}`,
    expectedInventoryVersion: 5,
    restockedQuantity,
    sourceQuantity: 12,
    sourceVersion: 'source-v2',
    observedAt: new Date(OBSERVED_AT),
    confirmedEffects: [{ operationKey: `DEDUCT-${variantId}-1`, expectedVersion: 1, sourceDocumentId: 'KV-ORDER-1' }],
    notReflectedEffects: [{ operationKey: `DEDUCT-${variantId}-2`, expectedVersion: 1 }],
  };
}

function fixture() {
  const receipt: PreparedReturnReceipt = {
    receiptKind: 'CUSTOMER_RETURN',
    receiptId: 15,
    receiptOperationKey: 'RETURN-15',
    orderId: 101,
    actorId: 9,
    sourceDocumentId: 'KV-RETURN-15',
    receivedAt: new Date(RECEIVED_AT),
    lines: [{
      receiptItemId: 601,
      orderItemId: 201,
      requestItemId: 401,
      variantId: 301,
      orderedQuantity: 5,
      receivedQuantity: 3,
      acceptedQuantity: 2,
      resalableQuantity: 2,
      operationKey: 'M03-RETURN-RECEIPT-ITEM-601-RESTOCK',
    }],
  };
  const evidence: VerifiedReturnEvidence = {
    receiptKind: 'CUSTOMER_RETURN',
    receiptId: 15,
    sourceDocumentId: 'KV-RETURN-15',
    snapshots: [snapshot()],
  };
  const service = new ReturnInventoryService(new InventoryLedgerService(), new PendingInventoryEffectService());
  return { receipt, evidence, service };
}

type Fixture = ReturnType<typeof fixture>;

function addLine(f: Fixture, variantId: number, resalableQuantity: number): void {
  f.receipt.lines.push({
    ...f.receipt.lines[0],
    receiptItemId: 602,
    orderItemId: 202,
    requestItemId: 402,
    variantId,
    resalableQuantity,
    operationKey: 'M03-RETURN-RECEIPT-ITEM-602-RESTOCK',
  });
}

function validate(f: Fixture): void {
  f.service.validateSourceEvidence(f.receipt, f.evidence);
}

function expectSourceError(action: () => void, status: number, code: string): void {
  try {
    action();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code} was not thrown`);
}

describe('ReturnInventoryService - source evidence validation', () => {
  it('SV-01: accepts matching customer return evidence without mutation', () => {
    const f = fixture();
    const before = JSON.stringify({ receipt: f.receipt, evidence: f.evidence });
    expect(() => validate(f)).not.toThrow();
    expect(JSON.stringify({ receipt: f.receipt, evidence: f.evidence })).toBe(before);
  });

  it('SV-02: accepts matching delivery return evidence', () => {
    const f = fixture();
    f.receipt.receiptKind = 'DELIVERY_RETURN';
    f.evidence.receiptKind = 'DELIVERY_RETURN';
    f.receipt.lines[0].requestItemId = null;
    f.receipt.lines[0].acceptedQuantity = null;
    f.receipt.lines[0].operationKey = 'M03-DELIVERY-RETURN-ITEM-601-RESTOCK';
    expect(() => validate(f)).not.toThrow();
  });

  it('SV-03: aggregates multiple lines of one SKU', () => {
    const f = fixture();
    addLine(f, 301, 1);
    f.evidence.snapshots[0].restockedQuantity = 3;
    expect(() => validate(f)).not.toThrow();
  });

  it('SV-04: accepts distinct positive SKUs in any snapshot order', () => {
    const f = fixture();
    addLine(f, 302, 1);
    f.evidence.snapshots.unshift(snapshot(302, 1));
    expect(() => validate(f)).not.toThrow();
  });

  it('SV-05: does not require a positive snapshot for a zero-resalable SKU', () => {
    const f = fixture();
    addLine(f, 302, 0);
    expect(() => validate(f)).not.toThrow();
  });

  it('SV-06: accepts linked zero-resalable receipt with empty snapshots', () => {
    const f = fixture();
    f.receipt.lines[0].resalableQuantity = 0;
    f.evidence.snapshots = [];
    expect(() => validate(f)).not.toThrow();
  });

  it('SV-07: accepts zero source stock and observation at receipt time', () => {
    const f = fixture();
    f.evidence.snapshots[0].sourceQuantity = 0;
    f.evidence.snapshots[0].observedAt = new Date(RECEIVED_AT);
    f.evidence.snapshots[0].confirmedEffects = [];
    f.evidence.snapshots[0].notReflectedEffects = [];
    expect(() => validate(f)).not.toThrow();
  });

  const invalidEvidence: Array<{ name: string; input: (f: Fixture) => unknown }> = [
    { name: 'SV-08: rejects null evidence', input: () => null },
    { name: 'SV-09: rejects invalid receipt ID', input: f => ({ ...f.evidence, receiptId: 0 }) },
    { name: 'SV-10: rejects unknown receipt kind', input: f => ({ ...f.evidence, receiptKind: 'UNKNOWN' }) },
    { name: 'SV-11: rejects empty source document ID', input: f => ({ ...f.evidence, sourceDocumentId: '' }) },
    { name: 'SV-12: rejects source document ID above length limit', input: f => ({ ...f.evidence, sourceDocumentId: 'X'.repeat(101) }) },
    { name: 'SV-13: rejects non-array snapshots', input: f => ({ ...f.evidence, snapshots: null }) },
  ];

  it.each(invalidEvidence)('$name', ({ input }) => {
    const f = fixture();
    expectSourceError(() => f.service.validateSourceEvidence(f.receipt, input(f) as VerifiedReturnEvidence), 400, 'VALIDATION_ERROR');
  });

  const conflicts: Array<{ name: string; change: (f: Fixture) => void }> = [
    { name: 'SV-14: rejects different receipt ID', change: f => { f.evidence.receiptId = 16; } },
    { name: 'SV-15: rejects different receipt kind', change: f => { f.evidence.receiptKind = 'DELIVERY_RETURN'; } },
    { name: 'SV-16: rejects unlinked source document', change: f => { f.receipt.sourceDocumentId = null; } },
    { name: 'SV-17: rejects different source document', change: f => { f.evidence.sourceDocumentId = 'OTHER-DOC'; } },
    { name: 'SV-18: rejects missing positive SKU snapshot', change: f => { addLine(f, 302, 1); } },
    { name: 'SV-19: rejects unexpected SKU snapshot', change: f => { f.evidence.snapshots.push(snapshot(302, 1)); } },
    { name: 'SV-20: rejects lower source restock quantity', change: f => { f.evidence.snapshots[0].restockedQuantity = 1; } },
    { name: 'SV-21: rejects higher source restock quantity', change: f => { f.evidence.snapshots[0].restockedQuantity = 3; } },
    { name: 'SV-22: rejects aggregate restock overflow', change: f => { f.receipt.lines[0].resalableQuantity = MAX_INT; addLine(f, 301, 1); } },
    { name: 'SV-23: rejects positive snapshot for zero-resalable receipt', change: f => { f.receipt.lines[0].resalableQuantity = 0; } },
  ];

  it.each(conflicts)('$name', ({ change }) => {
    const f = fixture();
    change(f);
    expectSourceError(() => validate(f), 409, 'CONFLICT');
  });

  const invalidSnapshots: Array<{ name: string; patch: Record<string, unknown> }> = [
    { name: 'SV-24: rejects invalid variant ID', patch: { variantId: 0 } },
    { name: 'SV-25: rejects whitespace in source variant ID', patch: { sourceVariantId: ' KV-SKU-301' } },
    { name: 'SV-26: rejects source variant ID above length limit', patch: { sourceVariantId: 'X'.repeat(65) } },
    { name: 'SV-27: rejects zero inventory version', patch: { expectedInventoryVersion: 0 } },
    { name: 'SV-28: rejects zero restock quantity snapshot', patch: { restockedQuantity: 0 } },
    { name: 'SV-29: rejects negative source stock', patch: { sourceQuantity: -1 } },
    { name: 'SV-30: rejects fractional source stock', patch: { sourceQuantity: 1.5 } },
    { name: 'SV-31: rejects source stock overflow', patch: { sourceQuantity: MAX_INT + 1 } },
    { name: 'SV-32: rejects empty source version', patch: { sourceVersion: '' } },
    { name: 'SV-33: rejects invalid observation date', patch: { observedAt: new Date(Number.NaN) } },
    { name: 'SV-34: rejects observation before receipt', patch: { observedAt: new Date(RECEIVED_AT.getTime() - 1) } },
    { name: 'SV-35: rejects future observation', patch: { observedAt: new Date('9999-01-01T00:00:00.000Z') } },
    { name: 'SV-36: rejects non-array confirmed effects', patch: { confirmedEffects: null } },
    { name: 'SV-37: rejects non-array unreflected effects', patch: { notReflectedEffects: null } },
    { name: 'SV-38: rejects confirmed effect without source document', patch: { confirmedEffects: [{ operationKey: 'KEY', expectedVersion: 1 }] } },
    { name: 'SV-39: rejects unreflected effect with invalid version', patch: { notReflectedEffects: [{ operationKey: 'KEY', expectedVersion: 0 }] } },
    { name: 'SV-40: rejects effect key above length limit', patch: { notReflectedEffects: [{ operationKey: 'X'.repeat(192), expectedVersion: 1 }] } },
  ];

  it.each(invalidSnapshots)('$name', ({ patch }) => {
    const f = fixture();
    Object.assign(f.evidence.snapshots[0], patch);
    expectSourceError(() => validate(f), 400, 'VALIDATION_ERROR');
  });

  const duplicates: Array<{ name: string; change: (f: Fixture) => void }> = [
    { name: 'SV-41: rejects repeated local variant', change: f => { f.evidence.snapshots.push(snapshot()); } },
    { name: 'SV-42: rejects repeated source variant across local SKUs', change: f => { addLine(f, 302, 1); const second = snapshot(302, 1); second.sourceVariantId = f.evidence.snapshots[0].sourceVariantId; f.evidence.snapshots.push(second); } },
    { name: 'SV-43: rejects duplicate confirmed effect', change: f => { const s = f.evidence.snapshots[0]; s.confirmedEffects.push({ ...s.confirmedEffects[0] }); } },
    { name: 'SV-44: rejects duplicate unreflected effect', change: f => { const s = f.evidence.snapshots[0]; s.notReflectedEffects.push({ ...s.notReflectedEffects[0] }); } },
    { name: 'SV-45: rejects effect in both classifications', change: f => { const s = f.evidence.snapshots[0]; s.notReflectedEffects.push({ operationKey: s.confirmedEffects[0].operationKey, expectedVersion: 1 }); } },
    { name: 'SV-46: rejects effect reused across SKU snapshots', change: f => { addLine(f, 302, 1); const second = snapshot(302, 1); second.notReflectedEffects.push({ ...f.evidence.snapshots[0].notReflectedEffects[0] }); f.evidence.snapshots.push(second); } },
  ];

  it.each(duplicates)('$name', ({ change }) => {
    const f = fixture();
    change(f);
    expectSourceError(() => validate(f), 400, 'VALIDATION_ERROR');
  });
});
