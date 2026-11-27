import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DeliveryStatus,
  InventoryReason,
  ReturnStatus,
  SyncState,
} from '@prisma/client';

import type { Prisma } from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import {
  buildReturnOperationKey,
  validateReturnReceiptQuantities,
} from './return-inventory.contract';

import type {
  ReturnReceiptKind,
  ReturnStockResult,
  VerifiedReturnEvidence,
  VerifiedReturnSourceSnapshot,
} from './return-inventory.contract';

import { InventoryLedgerService } from './inventory-ledger.service';
import type { PendingMovementInput } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';

export interface PreparedReturnLine {
  receiptItemId: number;
  orderItemId: number;
  requestItemId: number | null;
  variantId: number;
  orderedQuantity: number;
  receivedQuantity: number;
  acceptedQuantity: number | null;
  resalableQuantity: number;
  operationKey: string;
}

export interface PreparedReturnReceipt {
  receiptKind: ReturnReceiptKind;
  receiptId: number;
  receiptOperationKey: string;
  orderId: number;
  actorId: number | null;
  sourceDocumentId: string | null;
  receivedAt: Date;
  lines: PreparedReturnLine[];
}

export interface PreparedReturnSku {
  variantId: number;
  inventoryVersion: number;
  previousQuantity: number;
  projectedQuantity: number;
  projectedSyncStatus: SyncState;
  pendingDelta: string;
  snapshot: VerifiedReturnSourceSnapshot;
}

export interface PreparedReturnReconciliation {
  receipt: PreparedReturnReceipt;
  plans: PreparedReturnSku[];
}

/**
 * Kết quả kiểm tra phiếu không có hàng đủ điều kiện bán lại.
 * Không phải chứng từ tồn kho, không xác nhận đã đồng bộ KiotViet.
 */
export interface NonResalableReturnResult {
  receiptKind: ReturnReceiptKind;
  receiptId: number;
  orderId: number;
  outcome: 'NO_STOCK_CHANGE';
  restockedQuantity: 0;
}

@Injectable()
export class ReturnInventoryService {
  constructor(
    private readonly ledger: InventoryLedgerService,
    private readonly pendingEffects: PendingInventoryEffectService,
  ) {}

  private badRequest(
    message: string,
  ): BadRequestException {
    return new BadRequestException(
      apiErrorPayload(
        ErrorCode.VALIDATION_ERROR,
        message,
      ),
    );
  }

  private conflict(
    message: string,
  ): ConflictException {
    return new ConflictException(
      apiErrorPayload(
        ErrorCode.CONFLICT,
        message,
      ),
    );
  }

  private notFound(
    message: string,
  ): NotFoundException {
    return new NotFoundException(
      apiErrorPayload(
        ErrorCode.NOT_FOUND,
        message,
      ),
    );
  }

  private validInteger(
    value: unknown,
    minimum = 1,
  ): value is number {
    return (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= 2147483647
    );
  }

  private async lockOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: number }>
    >`
      SELECT id
      FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `;

    if (rows.length !== 1) {
      throw this.notFound(
        'Đơn hàng gốc không tồn tại.',
      );
    }

    return tx.order.findUniqueOrThrow({
      where: {
        id: orderId,
      },
      select: {
        id: true,
        userId: true,
        status: true,
        deliveryStatus: true,
      },
    });
  }

  private validateOrderItem(
    expectedOrderId: number,
    orderItem: {
      id: number;
      orderId: number;
      variantId: number;
      quantity: number;
    },
    receivedQuantity: number,
  ): void {
    if (
      orderItem.orderId !== expectedOrderId
    ) {
      throw this.conflict(
        'Chi tiết kiểm nhận không thuộc đơn hàng gốc.',
      );
    }

    if (
      !this.validInteger(orderItem.id) ||
      !this.validInteger(orderItem.variantId) ||
      !this.validInteger(orderItem.quantity)
    ) {
      throw this.conflict(
        'Chi tiết đơn hàng gốc không hợp lệ.',
      );
    }

    if (
      receivedQuantity > orderItem.quantity
    ) {
      throw this.conflict(
        'Số lượng thực nhận vượt số lượng đã mua.',
      );
    }
  }

  private finalizePreparation(
    receipt: PreparedReturnReceipt,
  ): PreparedReturnReceipt {
    if (receipt.lines.length === 0) {
      throw this.conflict(
        'Phiếu kiểm nhận không có chi tiết.',
      );
    }

    if (
      !(receipt.receivedAt instanceof Date) ||
      !Number.isFinite(
        receipt.receivedAt.getTime(),
      ) ||
      receipt.receivedAt.getTime() > Date.now()
    ) {
      throw this.conflict(
        'Thời điểm kiểm nhận không hợp lệ.',
      );
    }

    if (
      !receipt.lines.some(
        line => line.receivedQuantity > 0,
      )
    ) {
      throw this.conflict(
        'Phiếu kiểm nhận không có hàng thực nhận.',
      );
    }

    receipt.lines.sort(
      (a, b) =>
        a.variantId - b.variantId ||
        a.receiptItemId - b.receiptItemId,
    );

    return receipt;
  }

  private async prepareCustomerReturn(
    tx: Prisma.TransactionClient,
    receiptId: number,
  ): Promise<PreparedReturnReceipt> {
    const identity =
      await tx.returnReceipt.findUnique({
        where: {
          id: receiptId,
        },
        select: {
          requestId: true,
          request: {
            select: {
              orderId: true,
            },
          },
        },
      });

    if (!identity) {
      throw this.notFound(
        'Phiếu kiểm nhận đổi trả không tồn tại.',
      );
    }

    const order = await this.lockOrder(
      tx,
      identity.request.orderId,
    );

    const requestRows = await tx.$queryRaw<
      Array<{ id: number }>
    >`
      SELECT id
      FROM return_requests
      WHERE id = ${identity.requestId}
      FOR UPDATE
    `;

    if (requestRows.length !== 1) {
      throw this.notFound(
        'Yêu cầu đổi trả không tồn tại.',
      );
    }

    const receiptRows = await tx.$queryRaw<
      Array<{ id: number }>
    >`
      SELECT id
      FROM return_receipts
      WHERE id = ${receiptId}
      FOR UPDATE
    `;

    if (receiptRows.length !== 1) {
      throw this.notFound(
        'Phiếu kiểm nhận không tồn tại.',
      );
    }

    const receipt =
      await tx.returnReceipt.findUniqueOrThrow({
        where: {
          id: receiptId,
        },
        include: {
          request: true,
          items: {
            include: {
              requestItem: {
                include: {
                  orderItem: true,
                },
              },
            },
          },
        },
      });

    if (
      receipt.requestId !== identity.requestId ||
      receipt.request.orderId !== order.id ||
      receipt.request.userId !== order.userId
    ) {
      throw this.conflict(
        'Thông tin liên kết đổi trả không nhất quán.',
      );
    }

    if (
      order.status !== 'DELIVERED' ||
      order.deliveryStatus !== DeliveryStatus.DELIVERED
    ) {
      throw this.conflict(
        'Đơn hàng chưa đủ điều kiện đổi trả.',
      );
    }

    if (
      receipt.request.status !== ReturnStatus.RECEIVED &&
      receipt.request.status !== ReturnStatus.COMPLETED
    ) {
      throw this.conflict(
        'Yêu cầu đổi trả chưa được xác nhận thực nhận.',
      );
    }

    const lines: PreparedReturnLine[] = [];

    for (const item of receipt.items) {
      const requestItem = item.requestItem;
      const orderItem = requestItem.orderItem;

      if (
        requestItem.requestId !== receipt.requestId
      ) {
        throw this.conflict(
          'Chi tiết không thuộc yêu cầu đổi trả.',
        );
      }

      const quantity =
        validateReturnReceiptQuantities({
          kind: 'CUSTOMER_RETURN',
          receivedQuantity:
            item.receivedQuantity,
          acceptedQuantity:
            item.acceptedQuantity,
          resalableQuantity:
            item.resalableQuantity,
        });

      this.validateOrderItem(
        order.id,
        orderItem,
        item.receivedQuantity,
      );

      if (
        !this.validInteger(requestItem.quantity) ||
        !this.validInteger(
          requestItem.approvedQuantity,
          0,
        ) ||
        requestItem.quantity > orderItem.quantity ||
        requestItem.approvedQuantity >
          requestItem.quantity ||
        item.acceptedQuantity >
          requestItem.approvedQuantity
      ) {
        throw this.conflict(
          'Số lượng đổi trả vượt giới hạn được duyệt.',
        );
      }

      lines.push({
        receiptItemId: item.id,
        orderItemId: orderItem.id,
        requestItemId: requestItem.id,
        variantId: orderItem.variantId,
        orderedQuantity: orderItem.quantity,
        receivedQuantity: item.receivedQuantity,
        acceptedQuantity: item.acceptedQuantity,
        resalableQuantity: quantity,
        operationKey: buildReturnOperationKey(
          'CUSTOMER_RETURN',
          item.id,
        ),
      });
    }

    return this.finalizePreparation({
      receiptKind: 'CUSTOMER_RETURN',
      receiptId: receipt.id,
      receiptOperationKey: receipt.operationKey,
      orderId: order.id,
      actorId: receipt.actorId,
      sourceDocumentId: receipt.kiotDocumentId,
      receivedAt: receipt.receivedAt,
      lines,
    });
  }

  private async prepareDeliveryReturn(
    tx: Prisma.TransactionClient,
    receiptId: number,
  ): Promise<PreparedReturnReceipt> {
    const identity =
      await tx.deliveryReturnReceipt.findUnique({
        where: {
          id: receiptId,
        },
        select: {
          orderId: true,
        },
      });

    if (!identity) {
      throw this.notFound(
        'Phiếu nhận hàng giao thất bại không tồn tại.',
      );
    }

    const order = await this.lockOrder(
      tx,
      identity.orderId,
    );

    const receiptRows = await tx.$queryRaw<
      Array<{ id: number }>
    >`
      SELECT id
      FROM delivery_return_receipts
      WHERE id = ${receiptId}
      FOR UPDATE
    `;

    if (receiptRows.length !== 1) {
      throw this.notFound(
        'Phiếu nhận hàng hoàn không tồn tại.',
      );
    }

    const receipt =
      await tx.deliveryReturnReceipt.findUniqueOrThrow({
        where: {
          id: receiptId,
        },
        include: {
          items: {
            include: {
              orderItem: true,
            },
          },
        },
      });

    if (receipt.orderId !== order.id) {
      throw this.conflict(
        'Phiếu kiểm nhận không thuộc đơn hàng.',
      );
    }

    if (
      order.status !== 'DELIVERY_UNSUCCESSFUL' ||
      order.deliveryStatus !== DeliveryStatus.RETURNED
    ) {
      throw this.conflict(
        'Đơn giao thất bại chưa xác nhận nhận lại hàng.',
      );
    }

    const lines: PreparedReturnLine[] = [];

    for (const item of receipt.items) {
      const orderItem = item.orderItem;

      const quantity =
        validateReturnReceiptQuantities({
          kind: 'DELIVERY_RETURN',
          receivedQuantity:
            item.receivedQuantity,
          resalableQuantity:
            item.resalableQuantity,
        });

      this.validateOrderItem(
        order.id,
        orderItem,
        item.receivedQuantity,
      );

      lines.push({
        receiptItemId: item.id,
        orderItemId: orderItem.id,
        requestItemId: null,
        variantId: orderItem.variantId,
        orderedQuantity: orderItem.quantity,
        receivedQuantity: item.receivedQuantity,
        acceptedQuantity: null,
        resalableQuantity: quantity,
        operationKey: buildReturnOperationKey(
          'DELIVERY_RETURN',
          item.id,
        ),
      });
    }

    return this.finalizePreparation({
      receiptKind: 'DELIVERY_RETURN',
      receiptId: receipt.id,
      receiptOperationKey: receipt.sourceKey,
      orderId: order.id,
      actorId: receipt.actorId,
      sourceDocumentId: receipt.kiotDocumentId,
      receivedAt: receipt.receivedAt,
      lines,
    });
  }

  /**
   * Kiem tra cac phieu da luu, bao gom phieu hien tai.
   * Caller phai giu khoa Order va dung ReadCommitted.
   * Phieu kiem nhan da luu phai bat bien; moi writer
   * phai tuan thu cung quy uoc khoa.
   */
  private async validateCumulativeQuantities(
    tx: Prisma.TransactionClient,
    receipt: PreparedReturnReceipt,
  ): Promise<void> {
    const orderLimits = new Map<number, number>();
    const orderTotals = new Map<number, number>();
    const requestTotals = new Map<number, number>();
    const currentLines = new Map(
      receipt.lines.map(line => [line.receiptItemId, line]),
    );
    const seen = new Set<number>();

    for (const line of receipt.lines) {
      const previous = orderLimits.get(line.orderItemId);

      if (
        previous !== undefined &&
        previous !== line.orderedQuantity
      ) {
        throw this.conflict(
          'Số lượng đơn gốc không nhất quán.',
        );
      }

      orderLimits.set(
        line.orderItemId,
        line.orderedQuantity,
      );
    }

    if (currentLines.size !== receipt.lines.length) {
      throw this.conflict(
        'Chi tiết phiếu kiểm nhận bị trùng.',
      );
    }

    const orderItemIds = [...orderLimits.keys()];

    const addWithin = (
      totals: Map<number, number>,
      id: number,
      quantity: number,
      limit: number,
    ): void => {
      const next = (totals.get(id) ?? 0) + quantity;

      if (next > limit) {
        throw this.conflict(
          'Số lượng hoàn hàng cộng dồn vượt giới hạn.',
        );
      }

      totals.set(id, next);
    };

    const verifyCurrent = (
      kind: ReturnReceiptKind,
      receiptId: number,
      item: Pick<
        PreparedReturnLine,
        | 'receiptItemId'
        | 'orderItemId'
        | 'requestItemId'
        | 'receivedQuantity'
        | 'acceptedQuantity'
        | 'resalableQuantity'
      >,
    ): void => {
      if (
        kind !== receipt.receiptKind ||
        receiptId !== receipt.receiptId
      ) {
        return;
      }

      const expected = currentLines.get(
        item.receiptItemId,
      );

      if (
        !expected ||
        seen.has(item.receiptItemId) ||
        expected.orderItemId !== item.orderItemId ||
        expected.requestItemId !== item.requestItemId ||
        expected.receivedQuantity !== item.receivedQuantity ||
        expected.acceptedQuantity !== item.acceptedQuantity ||
        expected.resalableQuantity !== item.resalableQuantity
      ) {
        throw this.conflict(
          'Chi tiết kiểm nhận đã thay đổi hoặc không nhất quán.',
        );
      }

      seen.add(item.receiptItemId);
    };

    const customerItems =
      await tx.returnReceiptItem.findMany({
        where: {
          requestItem: {
            orderItemId: { in: orderItemIds },
          },
        },
        select: {
          id: true,
          receiptId: true,
          receivedQuantity: true,
          acceptedQuantity: true,
          resalableQuantity: true,
          receipt: {
            select: { requestId: true },
          },
          requestItem: {
            select: {
              id: true,
              requestId: true,
              orderItemId: true,
              quantity: true,
              approvedQuantity: true,
              request: {
                select: { orderId: true },
              },
            },
          },
        },
      });

    for (const item of customerItems) {
      const requestItem = item.requestItem;
      const limit = orderLimits.get(
        requestItem.orderItemId,
      );

      validateReturnReceiptQuantities({
        kind: 'CUSTOMER_RETURN',
        receivedQuantity: item.receivedQuantity,
        acceptedQuantity: item.acceptedQuantity,
        resalableQuantity: item.resalableQuantity,
      });

      if (
        limit === undefined ||
        item.receipt.requestId !== requestItem.requestId ||
        requestItem.request.orderId !== receipt.orderId ||
        !this.validInteger(requestItem.quantity) ||
        !this.validInteger(requestItem.approvedQuantity, 0) ||
        requestItem.quantity > limit ||
        requestItem.approvedQuantity > requestItem.quantity ||
        item.receivedQuantity > limit
      ) {
        throw this.conflict(
          'Dữ liệu lịch sử đổi trả không hợp lệ.',
        );
      }

      // Cong don hang da chap nhan, khong tinh lai
      // hang bi tu choi nhu hang da hoan tat doi tra.
      addWithin(
        requestTotals,
        requestItem.id,
        item.acceptedQuantity,
        requestItem.approvedQuantity,
      );

      addWithin(
        orderTotals,
        requestItem.orderItemId,
        item.acceptedQuantity,
        limit,
      );

      verifyCurrent(
        'CUSTOMER_RETURN',
        item.receiptId,
        {
          receiptItemId: item.id,
          orderItemId: requestItem.orderItemId,
          requestItemId: requestItem.id,
          receivedQuantity: item.receivedQuantity,
          acceptedQuantity: item.acceptedQuantity,
          resalableQuantity: item.resalableQuantity,
        },
      );
    }

    const deliveryItems =
      await tx.deliveryReturnItem.findMany({
        where: {
          orderItemId: { in: orderItemIds },
        },
        select: {
          id: true,
          receiptId: true,
          orderItemId: true,
          receivedQuantity: true,
          resalableQuantity: true,
          receipt: {
            select: { orderId: true },
          },
        },
      });

    for (const item of deliveryItems) {
      const limit = orderLimits.get(item.orderItemId);

      validateReturnReceiptQuantities({
        kind: 'DELIVERY_RETURN',
        receivedQuantity: item.receivedQuantity,
        resalableQuantity: item.resalableQuantity,
      });

      if (
        limit === undefined ||
        item.receipt.orderId !== receipt.orderId
      ) {
        throw this.conflict(
          'Dữ liệu lịch sử giao hoàn không hợp lệ.',
        );
      }

      // Giao hoan khong co acceptedQuantity.
      addWithin(
        orderTotals,
        item.orderItemId,
        item.receivedQuantity,
        limit,
      );

      verifyCurrent(
        'DELIVERY_RETURN',
        item.receiptId,
        {
          receiptItemId: item.id,
          orderItemId: item.orderItemId,
          requestItemId: null,
          receivedQuantity: item.receivedQuantity,
          acceptedQuantity: null,
          resalableQuantity: item.resalableQuantity,
        },
      );
    }

    if (seen.size !== currentLines.size) {
      throw this.conflict(
        'Không tìm thấy đầy đủ chi tiết kiểm nhận hiện tại.',
      );
    }
  }

  private validSourceString(
    value: unknown,
    maxLength: number,
  ): value is string {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maxLength &&
      value.trim() === value
    );
  }

  /**
   * Kiểm tra hình thức và sự phù hợp của bằng chứng M08.
   * Không gọi KiotViet, không cập nhật CSDL.
   * Chỉ sử dụng receipt được prepareReceipt tạo trong transaction.
   * M08 phải xác minh chứng từ, ánh xạ SKU và snapshot thật.
   */
  validateSourceEvidence(
    receipt: PreparedReturnReceipt,
    evidence: VerifiedReturnEvidence,
  ): void {
    if (
      !evidence ||
      typeof evidence !== 'object' ||
      !this.validInteger(evidence.receiptId) ||
      (evidence.receiptKind !== 'CUSTOMER_RETURN' &&
        evidence.receiptKind !== 'DELIVERY_RETURN') ||
      !this.validSourceString(evidence.sourceDocumentId, 100) ||
      !Array.isArray(evidence.snapshots)
    ) {
      throw this.badRequest('Bằng chứng nguồn không hợp lệ.');
    }

    if (
      receipt.receiptId !== evidence.receiptId ||
      receipt.receiptKind !== evidence.receiptKind
    ) {
      throw this.conflict('Bằng chứng nguồn không thuộc phiếu kiểm nhận.');
    }

    // Chỉ chấp nhận chứng từ đã được liên kết với phiếu.
    // Việc lưu liên kết thuộc trách nhiệm module gọi.
    if (receipt.sourceDocumentId !== evidence.sourceDocumentId) {
      throw this.conflict('Chứng từ nguồn chưa được liên kết hoặc không khớp.');
    }

    const expected = new Map<number, number>();

    for (const line of receipt.lines) {
      if (line.resalableQuantity === 0) {
        continue;
      }

      const total =
        (expected.get(line.variantId) ?? 0) + line.resalableQuantity;

      if (!this.validInteger(total)) {
        throw this.conflict('Tổng số lượng bán lại của SKU vượt giới hạn.');
      }

      expected.set(line.variantId, total);
    }

    const seenVariants = new Set<number>();
    const seenSourceVariants = new Set<string>();
    const seenEffects = new Set<string>();

    for (const snapshot of evidence.snapshots) {
      this.validateSourceSnapshot(snapshot, receipt.receivedAt);

      if (
        seenVariants.has(snapshot.variantId) ||
        seenSourceVariants.has(snapshot.sourceVariantId)
      ) {
        throw this.badRequest('Dữ liệu xác minh SKU bị trùng.');
      }

      if (
        expected.get(snapshot.variantId) !== snapshot.restockedQuantity
      ) {
        throw this.conflict('Số lượng hoàn tồn tại nguồn không khớp phiếu.');
      }

      seenVariants.add(snapshot.variantId);
      seenSourceVariants.add(snapshot.sourceVariantId);

      for (const effect of [
        ...snapshot.confirmedEffects,
        ...snapshot.notReflectedEffects,
      ]) {
        if (seenEffects.has(effect.operationKey)) {
          throw this.badRequest('Tác động chờ bị trùng hoặc phân loại mâu thuẫn.');
        }

        seenEffects.add(effect.operationKey);
      }
    }

    if (seenVariants.size !== expected.size) {
      throw this.conflict('Thiếu dữ liệu xác minh nguồn cho SKU cần hoàn tồn.');
    }
  }

  private validateSourceSnapshot(
    snapshot: VerifiedReturnSourceSnapshot,
    receivedAt: Date,
  ): void {
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      !this.validInteger(snapshot.variantId) ||
      !this.validSourceString(snapshot.sourceVariantId, 64) ||
      !this.validInteger(snapshot.expectedInventoryVersion) ||
      !this.validInteger(snapshot.restockedQuantity) ||
      !this.validInteger(snapshot.sourceQuantity, 0) ||
      !this.validSourceString(snapshot.sourceVersion, 100) ||
      !Array.isArray(snapshot.confirmedEffects) ||
      !Array.isArray(snapshot.notReflectedEffects)
    ) {
      throw this.badRequest('Snapshot tồn nguồn không hợp lệ.');
    }

    if (
      !(snapshot.observedAt instanceof Date) ||
      !Number.isFinite(snapshot.observedAt.getTime()) ||
      snapshot.observedAt.getTime() > Date.now() ||
      snapshot.observedAt.getTime() < receivedAt.getTime()
    ) {
      throw this.badRequest('Thời điểm xác minh nguồn không hợp lệ.');
    }

    for (const effect of snapshot.confirmedEffects) {
      if (
        !effect ||
        typeof effect !== 'object' ||
        !this.validSourceString(effect.operationKey, 191) ||
        !this.validInteger(effect.expectedVersion) ||
        !this.validSourceString(effect.sourceDocumentId, 100)
      ) {
        throw this.badRequest('Tác động đã xác nhận không hợp lệ.');
      }
    }

    for (const effect of snapshot.notReflectedEffects) {
      if (
        !effect ||
        typeof effect !== 'object' ||
        !this.validSourceString(effect.operationKey, 191) ||
        !this.validInteger(effect.expectedVersion)
      ) {
        throw this.badRequest('Tác động chưa phản ánh không hợp lệ.');
      }
    }
  }

  /**
   * Chỉ chuẩn bị lần áp dụng mới, chưa hỗ trợ replay.
   * Caller giữ cùng transaction ReadCommitted đến khi ghi/commit;
   * mọi writer phải khóa Order và SKU theo quy ước chung.
   * M08 phải điều phối độc quyền theo chứng từ nguồn, kể cả khác SKU.
   * Không nhận evidence từ HTTP và không dùng kế hoạch ở transaction khác.
   */
  async prepareSourceReconciliation(
    tx: Prisma.TransactionClient,
    kind: ReturnReceiptKind,
    receiptId: number,
    evidence: VerifiedReturnEvidence,
  ): Promise<PreparedReturnReconciliation> {
    const receipt = await this.prepareReceipt(tx, kind, receiptId);
    this.validateSourceEvidence(receipt, evidence);
    return this.prepareNewReconciliation(tx, receipt, evidence);
  }

  private async prepareNewReconciliation(
    tx: Prisma.TransactionClient,
    receipt: PreparedReturnReceipt,
    evidence: VerifiedReturnEvidence,
  ): Promise<PreparedReturnReconciliation> {
    const snapshots = [...evidence.snapshots].sort(
      (a, b) => a.variantId - b.variantId,
    );
    const plans: PreparedReturnSku[] = [];

    // Giữ khóa SKU trước khi đọc Inventory và tác động chờ.
    for (const snapshot of snapshots) {
      plans.push(await this.prepareSkuReconciliation(tx, snapshot));
    }

    await this.assertNewReturnOperation(tx, receipt, evidence.sourceDocumentId);

    return { receipt, plans };
  }

  /**
   * Kiểm tra phiếu toàn hàng không đủ điều kiện bán lại.
   * Không cần chứng từ tăng tồn đối với CUSTOMER_RETURN.
   * Không ghi CSDL, không xác nhận nguồn, không hoàn tất nghiệp vụ M06/M11.
   * Caller giữ transaction ReadCommitted và quy ước khóa Order.
   * Phiếu và chi tiết đã lưu phải bất biến. M08 vẫn chịu trách nhiệm
   * kiểm tra nguồn không nhập hàng hỏng vào tồn bán.
   */
  async validateNonResalableReturn(
    tx: Prisma.TransactionClient,
    kind: ReturnReceiptKind,
    receiptId: number,
  ): Promise<NonResalableReturnResult> {
    const receipt = await this.prepareReceipt(tx, kind, receiptId);
    await this.assertNoNonResalableOperations(tx, receipt);

    return {
      receiptKind: receipt.receiptKind,
      receiptId: receipt.receiptId,
      orderId: receipt.orderId,
      outcome: 'NO_STOCK_CHANGE',
      restockedQuantity: 0,
    };
  }

  private async assertNoNonResalableOperations(
    tx: Prisma.TransactionClient,
    receipt: PreparedReturnReceipt,
  ): Promise<void> {
    if (receipt.lines.some(line => line.resalableQuantity !== 0)) {
      throw this.conflict(
        'Phiếu có hàng đủ điều kiện bán lại; phải xác minh nguồn trước khi hoàn tồn.',
      );
    }

    const keys = receipt.lines.map(line => line.operationKey);
    const refIds = receipt.lines.map(line => line.receiptItemId);
    const refType = receipt.receiptKind === 'CUSTOMER_RETURN'
      ? 'RETURN_RECEIPT_ITEM'
      : 'DELIVERY_RETURN_ITEM';
    const sourceDocumentId = receipt.sourceDocumentId;

    if (sourceDocumentId !== null) {
      if (!this.validSourceString(sourceDocumentId, 100)) {
        throw this.conflict('Mã chứng từ nguồn của phiếu không hợp lệ.');
      }
      await this.assertSourceDocumentOwnership(tx, receipt, sourceDocumentId);
    } else if (receipt.receiptKind === 'DELIVERY_RETURN') {
      throw this.conflict('Phiếu nhận hàng giao thất bại thiếu chứng từ nguồn.');
    }

    // Không được bỏ qua chứng từ cũ nếu một dòng đã bị đổi từ dương về 0.
    const movement = await tx.inventoryMovement.findFirst({
      where: {
        OR: [
          { operationKey: { in: keys } },
          { refType, refId: { in: refIds } },
          ...(sourceDocumentId === null ? [] : [{
            reason: InventoryReason.RETURN_RECEIVED,
            sourceDocumentId,
          }]),
        ],
      },
      select: { id: true },
    });
    const effect = await tx.pendingInventoryEffect.findFirst({
      where: { operationKey: { in: keys } },
      select: { id: true },
    });
    if (movement || effect) {
      throw this.conflict(
        'Phiếu không bán lại được nhưng đã có chứng từ tồn kho. Cần đối soát.',
      );
    }
  }

  private returnMovementInput(
    receipt: PreparedReturnReceipt,
    line: PreparedReturnLine,
  ): PendingMovementInput {
    return {
      operationKey: line.operationKey,
      variantId: line.variantId,
      orderId: receipt.orderId,
      delta: line.resalableQuantity,
      reason: InventoryReason.RETURN_RECEIVED,
      refType: receipt.receiptKind === 'CUSTOMER_RETURN'
        ? 'RETURN_RECEIPT_ITEM'
        : 'DELIVERY_RETURN_ITEM',
      refId: line.receiptItemId,
      createdBy: receipt.actorId,
    };
  }

  /**
   * Internal M08 integration: new application or verified historical replay.
   * Evidence must be verified outside this service. The caller owns the
   * ReadCommitted transaction, holds the source-document coordination guard,
   * and must let every error escape the transaction callback.
   * Never expose evidence as a public HTTP request or reuse a prepared plan.
   */
  async applyVerifiedReturn(
    tx: Prisma.TransactionClient,
    kind: ReturnReceiptKind,
    receiptId: number,
    evidence: VerifiedReturnEvidence,
  ): Promise<ReturnStockResult[]> {
    const receipt = await this.prepareReceipt(tx, kind, receiptId);
    this.validateSourceEvidence(receipt, evidence);
    if (receipt.lines.every(line => line.resalableQuantity === 0)) {
      await this.assertNoNonResalableOperations(tx, receipt);
      return [];
    }
    await this.assertSourceDocumentOwnership(tx, receipt, evidence.sourceDocumentId);

    // Read historical results before checking current Inventory versions.
    // A successful replay must not apply any new stock mutation.
    const replay = await this.findReturnReplay(tx, receipt, evidence);
    if (replay !== null) {
      return replay;
    }

    const { plans } = await this.prepareNewReconciliation(tx, receipt, evidence);
    const results: ReturnStockResult[] = [];

    // Validate every SKU before writing any data. This first implementation
    // only records returns whose net sellable change equals the return delta.
    // Other source changes need a separate, audited M08 reconciliation.
    for (const plan of plans) {
      if (
        plan.projectedQuantity - plan.previousQuantity !==
        plan.snapshot.restockedQuantity
      ) {
        throw this.conflict(
          'Chênh lệch tồn bán không chỉ do hàng hoàn. Cần đối soát nguồn riêng.',
        );
      }
    }

    for (const plan of plans) {
      const snapshot = plan.snapshot;
      const lines = receipt.lines.filter(
        line => line.variantId === plan.variantId && line.resalableQuantity > 0,
      );
      const inputs = lines.map(line => this.returnMovementInput(receipt, line));

      for (const input of inputs) {
        if (await this.ledger.findRecordedOperation(tx, input)) {
          throw this.conflict('Nghiệp vụ đã được ghi nhận; cần xử lý replay riêng.');
        }
      }

      // Acknowledged effects are already included in sourceQuantity.
      for (const effect of snapshot.confirmedEffects) {
        const released = await this.pendingEffects.releaseConfirmed(tx, {
          operationKey: effect.operationKey,
          variantId: plan.variantId,
          expectedVersion: effect.expectedVersion,
          sourceDocumentId: effect.sourceDocumentId,
          acknowledgedAt: snapshot.observedAt,
        });
        if (released.replayed) {
          throw this.conflict('Tác động chờ đã thay đổi trong lúc đối soát.');
        }
      }

      // Set the projected quantity, not an additional increment of the
      // returned quantity. The source snapshot already includes the return.
      const updated = await tx.inventory.updateMany({
        where: {
          variantId: plan.variantId,
          version: plan.inventoryVersion,
          quantity: plan.previousQuantity,
        },
        data: {
          quantity: plan.projectedQuantity,
          sourceQuantity: snapshot.sourceQuantity,
          sourceVersion: snapshot.sourceVersion,
          lastConfirmedAt: snapshot.observedAt,
          syncStatus: plan.projectedSyncStatus,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(apiErrorPayload(
          ErrorCode.VERSION_CONFLICT,
          'Tồn kho đã thay đổi trong lúc ghi nhận hàng hoàn.',
        ));
      }

      const inventoryVersion = plan.inventoryVersion + 1;
      for (const input of inputs) {
        // The new return effect is immediately confirmed inside this same
        // transaction; it must never remain pending after a successful commit.
        const recorded = await this.ledger.appendPendingMovement(
          tx, input, inventoryVersion,
        );
        const released = await this.pendingEffects.releaseConfirmed(tx, {
          operationKey: input.operationKey,
          variantId: input.variantId,
          expectedVersion: 1,
          sourceDocumentId: evidence.sourceDocumentId,
          acknowledgedAt: snapshot.observedAt,
        });
        if (released.replayed || released.status !== SyncState.CONFIRMED) {
          throw this.conflict('Không thể xác nhận tác động hàng hoàn mới.');
        }
        // refId is always the positive receipt item ID built above.
        const line = lines.find(item => item.operationKey === input.operationKey);
        if (!line) {
          throw this.conflict('Không tìm thấy chi tiết kiểm nhận tương ứng.');
        }
        results.push({
          ...recorded,
          receiptKind: receipt.receiptKind,
          receiptItemId: line.receiptItemId,
          replayed: false,
        });
      }
    }

    return results;
  }

  /**
   * Replay checks the immutable recorded operation, not the latest stock.
   * The original snapshot version and acknowledgement time must match.
   * Historical sourceQuantity/sourceVersion and the complete old evidence
   * are not persisted by this service, so replay does not reapply or certify
   * those snapshot values. Receipt lines must remain immutable after posting.
   */
  private async findReturnReplay(
    tx: Prisma.TransactionClient,
    receipt: PreparedReturnReceipt,
    evidence: VerifiedReturnEvidence,
  ): Promise<ReturnStockResult[] | null> {
    const keys = receipt.lines.map(line => line.operationKey);
    const positive = receipt.lines.filter(line => line.resalableQuantity > 0);
    const movements = await tx.inventoryMovement.findMany({
      where: {
        OR: [
          { operationKey: { in: keys } },
          {
            reason: InventoryReason.RETURN_RECEIVED,
            sourceDocumentId: evidence.sourceDocumentId,
          },
        ],
      },
    });
    const effects = await tx.pendingInventoryEffect.findMany({
      where: { operationKey: { in: keys } },
    });

    if (movements.length === 0 && effects.length === 0) {
      return null;
    }

    // A partial result or an extra operation for the same source document
    // must never be completed by adding stock again.
    if (
      positive.length === 0 ||
      movements.length !== positive.length ||
      effects.length !== positive.length
    ) {
      throw this.conflict('Chứng từ hàng hoàn bị thiếu hoặc không nhất quán.');
    }

    const movementByKey = new Map(movements.map(row => [row.operationKey, row]));
    const effectByKey = new Map(effects.map(row => [row.operationKey, row]));
    const snapshotBySku = new Map(
      evidence.snapshots.map(snapshot => [snapshot.variantId, snapshot]),
    );
    const results: ReturnStockResult[] = [];

    for (const line of positive) {
      const movement = movementByKey.get(line.operationKey);
      const effect = effectByKey.get(line.operationKey);
      const snapshot = snapshotBySku.get(line.variantId);

      if (
        !movement || !effect || !snapshot ||
        movement.sourceDocumentId !== evidence.sourceDocumentId ||
        effect.sourceDocumentId !== evidence.sourceDocumentId ||
        effect.status !== SyncState.CONFIRMED ||
        !(effect.releasedAt instanceof Date) ||
        !Number.isFinite(effect.releasedAt.getTime()) ||
        !(effect.sourceAcknowledgedAt instanceof Date) ||
        effect.sourceAcknowledgedAt.getTime() !== snapshot.observedAt.getTime() ||
        !this.validInteger(movement.inventoryVersion) ||
        movement.inventoryVersion !== snapshot.expectedInventoryVersion + 1
      ) {
        throw this.conflict('Dữ liệu xác nhận hàng hoàn đã ghi không khớp replay.');
      }

      // Reuse ledger identity validation: key, order, variant, delta,
      // reason, reference, actor and note must match the original operation.
      const recorded = await this.ledger.findRecordedOperation(
        tx, this.returnMovementInput(receipt, line),
      );
      if (!recorded) {
        throw this.conflict('Không tìm thấy đầy đủ nghiệp vụ hàng hoàn đã ghi.');
      }
      results.push({
        ...recorded,
        receiptKind: receipt.receiptKind,
        receiptItemId: line.receiptItemId,
        replayed: true,
      });
    }

    return results;
  }

  private async assertSourceDocumentOwnership(
    tx: Prisma.TransactionClient,
    receipt: PreparedReturnReceipt,
    sourceDocumentId: string,
  ): Promise<void> {
    // Không cho một chứng từ tăng tồn được gắn với nhiều phiếu.
    const otherCustomer = await tx.returnReceipt.findFirst({
      where: {
        kiotDocumentId: sourceDocumentId,
        ...(receipt.receiptKind === 'CUSTOMER_RETURN'
          ? { id: { not: receipt.receiptId } }
          : {}),
      },
      select: { id: true },
    });
    const otherDelivery = await tx.deliveryReturnReceipt.findFirst({
      where: {
        kiotDocumentId: sourceDocumentId,
        ...(receipt.receiptKind === 'DELIVERY_RETURN'
          ? { id: { not: receipt.receiptId } }
          : {}),
      },
      select: { id: true },
    });
    if (otherCustomer || otherDelivery) {
      throw this.conflict('Chứng từ nguồn đã liên kết với phiếu khác.');
    }
  }

  private async assertNewReturnOperation(
    tx: Prisma.TransactionClient,
    receipt: PreparedReturnReceipt,
    sourceDocumentId: string,
  ): Promise<void> {
    await this.assertSourceDocumentOwnership(tx, receipt, sourceDocumentId);
    const keys = receipt.lines.map(line => line.operationKey);
    const movement = await tx.inventoryMovement.findFirst({
      where: {
        OR: [
          { operationKey: { in: keys } },
          { reason: InventoryReason.RETURN_RECEIVED, sourceDocumentId },
        ],
      },
      select: { id: true },
    });
    const effect = await tx.pendingInventoryEffect.findFirst({
      where: { operationKey: { in: keys } },
      select: { id: true },
    });
    if (movement || effect) {
      throw this.conflict('Nghiệp vụ đã có chứng từ; cần xử lý replay riêng.');
    }
  }

  private async prepareSkuReconciliation(
    tx: Prisma.TransactionClient,
    snapshot: VerifiedReturnSourceSnapshot,
  ): Promise<PreparedReturnSku> {
    const variantRows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM product_variants
      WHERE id = ${snapshot.variantId} FOR UPDATE
    `;
    if (variantRows.length !== 1) {
      throw this.notFound('SKU không tồn tại.');
    }
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: snapshot.variantId },
      select: { kiotvietVariantId: true },
    });
    if (variant.kiotvietVariantId !== snapshot.sourceVariantId) {
      throw this.conflict('Ánh xạ SKU KiotViet không khớp.');
    }

    const inventoryRows = await tx.$queryRaw<Array<{ variantId: number }>>`
      SELECT variantId FROM inventories
      WHERE variantId = ${snapshot.variantId} FOR UPDATE
    `;
    if (inventoryRows.length !== 1) {
      throw this.notFound('Tồn kho không tồn tại.');
    }
    const inventory = await tx.inventory.findUniqueOrThrow({
      where: { variantId: snapshot.variantId },
    });
    if (inventory.version !== snapshot.expectedInventoryVersion) {
      throw new ConflictException(apiErrorPayload(
        ErrorCode.VERSION_CONFLICT,
        'Tồn kho đã thay đổi. Cần xác minh lại nguồn.',
      ));
    }
    if (
      !this.validInteger(inventory.version) ||
      inventory.version >= 2147483647 ||
      !this.validInteger(inventory.quantity, 0)
    ) {
      throw this.conflict('Dữ liệu tồn kho không hợp lệ hoặc vượt giới hạn.');
    }
    if (
      (inventory.lastConfirmedAt &&
        snapshot.observedAt <= inventory.lastConfirmedAt) ||
      inventory.sourceVersion === snapshot.sourceVersion
    ) {
      throw this.conflict('Snapshot nguồn không mới hơn lần đối soát trước.');
    }

    // Bao gồm cả trạng thái bất thường để không vô tình bỏ sót tác động.
    const effects = await tx.pendingInventoryEffect.findMany({
      where: {
        variantId: snapshot.variantId,
        OR: [
          { releasedAt: null },
          { status: { not: SyncState.CONFIRMED } },
        ],
      },
    });
    const confirmed = new Map(
      snapshot.confirmedEffects.map(effect => [effect.operationKey, effect]),
    );
    const notReflected = new Map(
      snapshot.notReflectedEffects.map(effect => [effect.operationKey, effect]),
    );
    if (effects.length !== confirmed.size + notReflected.size) {
      throw this.conflict('Danh sách tác động chờ không đầy đủ hoặc bị thừa.');
    }
    const movements = await tx.inventoryMovement.findMany({
      where: { operationKey: { in: effects.map(effect => effect.operationKey) } },
    });
    const movementByKey = new Map(
      movements.map(movement => [movement.operationKey, movement]),
    );
    let pendingDelta = BigInt(0);
    let needsReconciliation = false;

    for (const effect of effects) {
      const confirmedItem = confirmed.get(effect.operationKey);
      const remainingItem = notReflected.get(effect.operationKey);
      const expected = confirmedItem ?? remainingItem;
      const movement = movementByKey.get(effect.operationKey);
      if (
        !expected ||
        effect.releasedAt !== null ||
        (effect.status !== SyncState.PENDING &&
          effect.status !== SyncState.NEEDS_RECONCILIATION) ||
        !this.validInteger(effect.version) ||
        !Number.isSafeInteger(effect.delta) ||
        effect.delta === 0 ||
        effect.delta < -2147483647 ||
        effect.delta > 2147483647 ||
        !movement ||
        movement.variantId !== snapshot.variantId ||
        movement.delta !== effect.delta ||
        movement.sourceDocumentId !== effect.sourceDocumentId
      ) {
        throw this.conflict('Tác động chờ và sổ biến động không nhất quán.');
      }
      if (effect.version !== expected.expectedVersion) {
        throw new ConflictException(apiErrorPayload(
          ErrorCode.VERSION_CONFLICT,
          'Phiên bản tác động chờ đã thay đổi.',
        ));
      }
      if (confirmedItem) {
        if (
          effect.version >= 2147483647 ||
          (effect.sourceDocumentId !== null &&
            effect.sourceDocumentId !== confirmedItem.sourceDocumentId) ||
          (effect.sourceAcknowledgedAt &&
            effect.sourceAcknowledgedAt > snapshot.observedAt)
        ) {
          throw this.conflict('Bằng chứng xác nhận tác động chờ không khớp.');
        }
      } else {
        if (effect.sourceAcknowledgedAt !== null) {
          throw this.conflict('Tác động đã có xác nhận nguồn nhưng bị phân loại chưa phản ánh.');
        }
        pendingDelta += BigInt(effect.delta);
        needsReconciliation ||= effect.status === SyncState.NEEDS_RECONCILIATION;
      }
    }

    // Tồn nguồn đã bao gồm lượng hàng hoàn; tuyệt đối không cộng lần nữa.
    const calculated = BigInt(snapshot.sourceQuantity) + pendingDelta;
    if (calculated > BigInt(2147483647)) {
      throw this.conflict('Tồn bán dự kiến vượt giới hạn hỗ trợ.');
    }
    const quantity = calculated < BigInt(0) ? 0 : Number(calculated);
    const syncStatus = calculated < BigInt(0) || needsReconciliation
      ? SyncState.NEEDS_RECONCILIATION
      : notReflected.size > 0 ? SyncState.PENDING : SyncState.CONFIRMED;

    return {
      variantId: snapshot.variantId,
      inventoryVersion: inventory.version,
      previousQuantity: inventory.quantity,
      projectedQuantity: quantity,
      projectedSyncStatus: syncStatus,
      pendingDelta: pendingDelta.toString(),
      snapshot,
    };
  }

  /**
   * Chuan bi du lieu trong transaction cua module goi.
   *
   * Caller phai su dung ReadCommitted va thong nhat
   * thu tu khoa Order truoc khi thay doi phieu.
   *
   * Phuong thuc nay chua cap nhat ton kho,
   * chua xac minh nguon; da kiem tra cong don.
   */
  async prepareReceipt(
    tx: Prisma.TransactionClient,
    kind: ReturnReceiptKind,
    receiptId: number,
  ): Promise<PreparedReturnReceipt> {
    if (!this.validInteger(receiptId)) {
      throw this.badRequest(
        'ID phiếu kiểm nhận không hợp lệ.',
      );
    }

    let receipt: PreparedReturnReceipt;

    switch (kind) {
      case 'CUSTOMER_RETURN':
        receipt = await this.prepareCustomerReturn(
          tx,
          receiptId,
        );
        break;

      case 'DELIVERY_RETURN':
        receipt = await this.prepareDeliveryReturn(
          tx,
          receiptId,
        );
        break;

      default:
        throw this.badRequest(
          'Loại phiếu kiểm nhận không hợp lệ.',
        );
    }

    await this.validateCumulativeQuantities(tx, receipt);

    return receipt;
  }
}
