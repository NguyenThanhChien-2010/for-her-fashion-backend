import { BadRequestException } from '@nestjs/common';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import type {
  RecordedInventoryOperation,
} from './inventory-ledger.service';

import type {
  VerifiedPendingEffect,
} from './inventory-reconciliation.service';

export type ReturnReceiptKind =
  | 'CUSTOMER_RETURN'
  | 'DELIVERY_RETURN';

export type ReturnReceiptQuantityInput =
  | {
      kind: 'CUSTOMER_RETURN';
      receivedQuantity: number;
      acceptedQuantity: number;
      resalableQuantity: number;
    }
  | {
      kind: 'DELIVERY_RETURN';
      receivedQuantity: number;
      resalableQuantity: number;
    };

export interface UnreflectedPendingEffect {
  operationKey: string;
  expectedVersion: number;
}

/**
 * Du lieu noi bo do M08 xac minh.
 * Khong nhan truc tiep tu HTTP client.
 */
export interface VerifiedReturnSourceSnapshot {
  variantId: number;
  sourceVariantId: string;

  expectedInventoryVersion: number;

  restockedQuantity: number;
  sourceQuantity: number;
  sourceVersion: string;
  observedAt: Date;

  confirmedEffects: VerifiedPendingEffect[];

  notReflectedEffects: UnreflectedPendingEffect[];
}

/**
 * Hop dong bang chung nguon.
 * Kieu du lieu nay khong tu chung minh
 * chung tu da duoc KiotViet xac minh.
 */
export interface VerifiedReturnEvidence {
  receiptKind: ReturnReceiptKind;
  receiptId: number;

  sourceDocumentId: string;

  snapshots: VerifiedReturnSourceSnapshot[];
}

export interface ReturnStockResult
  extends RecordedInventoryOperation {
  receiptKind: ReturnReceiptKind;
  receiptItemId: number;
  replayed: boolean;
}

const MAX_SUPPORTED_INTEGER = 2147483647;

function invalid(message: string): never {
  throw new BadRequestException(
    apiErrorPayload(
      ErrorCode.VALIDATION_ERROR,
      message,
    ),
  );
}

function validInteger(
  value: unknown,
  minimum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= MAX_SUPPORTED_INTEGER
  );
}

export function validateReturnReceiptQuantities(
  input: ReturnReceiptQuantityInput,
): number {
  if (!input || typeof input !== 'object') {
    return invalid(
      'Dữ liệu kiểm nhận không hợp lệ.',
    );
  }

  if (
    input.kind !== 'CUSTOMER_RETURN' &&
    input.kind !== 'DELIVERY_RETURN'
  ) {
    return invalid(
      'Loại phiếu kiểm nhận không hợp lệ.',
    );
  }

  if (!validInteger(input.receivedQuantity, 0)) {
    return invalid(
      'Số lượng thực nhận không hợp lệ.',
    );
  }

  if (!validInteger(input.resalableQuantity, 0)) {
    return invalid(
      'Số lượng đủ điều kiện bán lại không hợp lệ.',
    );
  }

  if (input.kind === 'CUSTOMER_RETURN') {
    if (!validInteger(input.acceptedQuantity, 0)) {
      return invalid(
        'Số lượng chấp nhận đổi trả không hợp lệ.',
      );
    }

    if (
      input.acceptedQuantity >
      input.receivedQuantity
    ) {
      return invalid(
        'Số lượng chấp nhận vượt số lượng thực nhận.',
      );
    }

    if (
      input.resalableQuantity >
      input.acceptedQuantity
    ) {
      return invalid(
        'Số lượng bán lại vượt số lượng chấp nhận.',
      );
    }
  }

  if (
    input.resalableQuantity >
    input.receivedQuantity
  ) {
    return invalid(
      'Số lượng bán lại vượt số lượng thực nhận.',
    );
  }

  return input.resalableQuantity;
}

export function buildReturnOperationKey(
  kind: ReturnReceiptKind,
  receiptItemId: number,
): string {
  if (!validInteger(receiptItemId, 1)) {
    return invalid(
      'ID chi tiết phiếu kiểm nhận không hợp lệ.',
    );
  }

  switch (kind) {
    case 'CUSTOMER_RETURN':
      return `M03-RETURN-RECEIPT-ITEM-${receiptItemId}-RESTOCK`;

    case 'DELIVERY_RETURN':
      return `M03-DELIVERY-RETURN-ITEM-${receiptItemId}-RESTOCK`;

    default:
      return invalid(
        'Loại phiếu kiểm nhận không hợp lệ.',
      );
  }
}
