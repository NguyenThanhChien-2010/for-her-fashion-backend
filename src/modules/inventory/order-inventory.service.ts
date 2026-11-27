import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  InventoryReason,
  Prisma,
  ProductStatus,
  SyncState,
} from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryLedgerService } from './inventory-ledger.service';

import type {
  PendingMovementInput,
  RecordedInventoryOperation,
} from './inventory-ledger.service';

export interface StockRequestItem {
  variantId: number;
  quantity: number;
}

export interface OrderStockResult
  extends RecordedInventoryOperation {
  replayed: boolean;
}

@Injectable()
export class OrderInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  private badRequest(message: string): BadRequestException {
    return new BadRequestException(
      apiErrorPayload(ErrorCode.VALIDATION_ERROR, message),
    );
  }

  private conflict(message: string): ConflictException {
    return new ConflictException(
      apiErrorPayload(ErrorCode.CONFLICT, message),
    );
  }

  private insufficientStock(
    variantId: number,
  ): ConflictException {
    return new ConflictException({
      code: 'INSUFFICIENT_STOCK',
      message: 'SKU không đủ tồn bán hoặc không còn được bán.',
      details: [
        {
          field: 'items.quantity',
          message: `Kiểm tra lại số lượng của SKU ${variantId}.`,
        },
      ],
    });
  }

  private validPositiveInt(value: number): boolean {
    return (
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= 2147483647
    );
  }

  private normalizeItems(
    items: StockRequestItem[],
  ): StockRequestItem[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw this.badRequest(
        'Danh sách sản phẩm không hợp lệ.',
      );
    }

    const quantities = new Map<number, number>();

    for (const item of items) {
      if (
        !item ||
        !this.validPositiveInt(item.variantId) ||
        !this.validPositiveInt(item.quantity)
      ) {
        throw this.badRequest(
          'variantId hoặc số lượng không hợp lệ.',
        );
      }

      const quantity =
        (quantities.get(item.variantId) ?? 0) +
        item.quantity;

      if (!this.validPositiveInt(quantity)) {
        throw this.badRequest(
          'Tổng số lượng vượt giới hạn hỗ trợ.',
        );
      }

      quantities.set(item.variantId, quantity);
    }

    return Array.from(
      quantities,
      ([variantId, quantity]) => ({
        variantId,
        quantity,
      }),
    ).sort((a, b) => a.variantId - b.variantId);
  }

  /**
   * Read-only check for cart and buy-now flows.
   * A successful check does not reserve stock.
   */
  async assertAvailable(
    items: StockRequestItem[],
  ): Promise<void> {
    const requested = this.normalizeItems(items);

    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: {
          in: requested.map(item => item.variantId),
        },
        isActive: true,
        product: {
          is: {
            status: ProductStatus.ACTIVE,
          },
        },
      },
      select: {
        id: true,
        inventory: {
          select: {
            quantity: true,
          },
        },
      },
    });

    const available = new Map(
      variants.map(variant => [
        variant.id,
        Math.max(0, variant.inventory?.quantity ?? 0),
      ]),
    );

    for (const item of requested) {
      if (
        (available.get(item.variantId) ?? 0) <
        item.quantity
      ) {
        throw this.insufficientStock(item.variantId);
      }
    }
  }

  /**
   * Stable key shared with cancellation and reconciliation.
   */
  private deductionInput(
    orderId: number,
    item: StockRequestItem,
  ): PendingMovementInput {
    return {
      operationKey:
        `M03-ORDER-${orderId}-SKU-${item.variantId}-DEDUCT`,
      variantId: item.variantId,
      orderId,
      delta: -item.quantity,
      reason: InventoryReason.ORDER_CREATED,
      refType: 'ORDER',
      refId: orderId,
    };
  }

  /**
   * M06 must call this method in the SAME transaction
   * that creates the order and its order items.
   *
   * Use ReadCommitted isolation.
   * Do not catch and commit stock-related failures.
   */
  async deductForOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<OrderStockResult[]> {
    if (!this.validPositiveInt(orderId)) {
      throw this.badRequest('orderId không hợp lệ.');
    }

    const lockedOrders = await tx.$queryRaw<
      Array<{ id: number }>
    >`
      SELECT id
      FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `;

    if (lockedOrders.length !== 1) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Đơn hàng không tồn tại.',
        ),
      );
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        deliveryStatus: true,
        items: {
          select: {
            variantId: true,
            quantity: true,
          },
        },
      },
    });

    if (
      ![
        'AWAITING_PAYMENT',
        'AWAITING_CONFIRMATION',
      ].includes(order.status) ||
      order.deliveryStatus !== 'NOT_SHIPPED'
    ) {
      throw this.conflict(
        'Trạng thái đơn không cho phép trừ tồn.',
      );
    }

    const items = this.normalizeItems(order.items);
    const results: OrderStockResult[] = [];

    // Always acquire SKU locks in ascending ID order.
    for (const item of items) {
      const lockedVariants = await tx.$queryRaw<
        Array<{ id: number }>
      >`
        SELECT id
        FROM product_variants
        WHERE id = ${item.variantId}
        FOR UPDATE
      `;

      if (lockedVariants.length !== 1) {
        throw this.insufficientStock(item.variantId);
      }

      const input = this.deductionInput(orderId, item);

      const existing =
        await this.ledger.findRecordedOperation(tx, input);

      if (existing) {
        results.push({
          ...existing,
          replayed: true,
        });

        continue;
      }

      const variant = await tx.productVariant.findFirst({
        where: {
          id: item.variantId,
          isActive: true,
          product: {
            is: {
              status: ProductStatus.ACTIVE,
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!variant) {
        throw this.insufficientStock(item.variantId);
      }

      const lockedInventory = await tx.$queryRaw<
        Array<{
          quantity: number;
          version: number;
          syncStatus: SyncState;
        }>
      >`
        SELECT quantity, version, syncStatus
        FROM inventories
        WHERE variantId = ${item.variantId}
        FOR UPDATE
      `;

      const inventory = lockedInventory[0];

      if (
        !inventory ||
        inventory.quantity < item.quantity
      ) {
        throw this.insufficientStock(item.variantId);
      }

      if (inventory.version >= 2147483647) {
        throw this.conflict(
          'Version tồn kho vượt giới hạn cập nhật.',
        );
      }

      const changed = await tx.inventory.updateMany({
        where: {
          variantId: item.variantId,
          version: inventory.version,
          quantity: {
            gte: item.quantity,
          },
        },
        data: {
          quantity: {
            decrement: item.quantity,
          },
          version: {
            increment: 1,
          },
          syncStatus:
            inventory.syncStatus ===
              SyncState.NEEDS_RECONCILIATION
              ? SyncState.NEEDS_RECONCILIATION
              : SyncState.PENDING,
        },
      });

      if (changed.count !== 1) {
        throw this.conflict(
          'Tồn kho đã thay đổi. Vui lòng kiểm tra lại.',
        );
      }

      const recorded =
        await this.ledger.appendPendingMovement(
          tx,
          input,
          inventory.version + 1,
        );

      results.push({
        ...recorded,
        replayed: false,
      });
    }

    return results;
  }

  /**
   * Release stock for a cancelled, unshipped order.
   *
   * The caller must provide verified local-only source evidence
   * and prevent concurrent external dispatch for this order.
   *
   * Use the same ReadCommitted transaction for all stock changes.
   * Never catch an error and commit a partial release.
   */
  async releaseForOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
    reason:
      | typeof InventoryReason.ORDER_CANCELLED
      | typeof InventoryReason.PAYMENT_EXPIRED,
    sourceDisposition: 'VERIFIED_LOCAL_ONLY',
  ): Promise<OrderStockResult[]> {
    if (!this.validPositiveInt(orderId)) {
      throw this.badRequest('orderId không hợp lệ.');
    }

    if (
      reason !== InventoryReason.ORDER_CANCELLED &&
      reason !== InventoryReason.PAYMENT_EXPIRED
    ) {
      throw this.badRequest(
        'Nguyên nhân hoàn tồn không hợp lệ.',
      );
    }

    if (sourceDisposition !== 'VERIFIED_LOCAL_ONLY') {
      throw this.conflict(
        'Chưa xác minh được trạng thái tồn kho tại nguồn.',
      );
    }

    const lockedOrders = await tx.$queryRaw<
      Array<{ id: number }>
    >`
      SELECT id
      FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `;

    if (lockedOrders.length !== 1) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Đơn hàng không tồn tại.',
        ),
      );
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        deliveryStatus: true,
        paymentMethod: true,
        paymentStatus: true,
        paymentExpiresAt: true,
        paymentSummary: {
          select: {
            status: true,
            paidAmount: true,
          },
        },
        items: {
          select: {
            variantId: true,
            quantity: true,
          },
        },
      },
    });

    if (
      order.status !== 'CANCELLED' ||
      order.deliveryStatus !== 'NOT_SHIPPED'
    ) {
      throw this.conflict(
        'Trạng thái đơn không cho phép hoàn tồn.',
      );
    }

    if (reason === InventoryReason.PAYMENT_EXPIRED) {
      if (
        order.paymentMethod !== 'MOMO' ||
        order.paymentStatus !== 'UNPAID' ||
        !order.paymentExpiresAt ||
        order.paymentExpiresAt.getTime() > Date.now()
      ) {
        throw this.conflict(
          'Đơn hàng không đủ điều kiện hết hạn thanh toán.',
        );
      }

      if (
        order.paymentSummary &&
        (
          order.paymentSummary.status !== 'UNPAID' ||
          order.paymentSummary.paidAmount.gt(0)
        )
      ) {
        throw this.conflict(
          'Thông tin thanh toán chưa nhất quán.',
        );
      }

      const unresolvedPayments = await tx.payment.count({
        where: {
          orderId,
          OR: [
            {
              status: {
                in: ['PENDING', 'UNKNOWN', 'SUCCEEDED'],
              },
            },
            {
              paidAt: { not: null },
            },
          ],
        },
      });

      if (unresolvedPayments > 0) {
        throw this.conflict(
          'Giao dịch thanh toán chưa được xử lý dứt điểm.',
        );
      }
    }

    const items = this.normalizeItems(order.items);
    const results: OrderStockResult[] = [];

    let sourceChecked = false;

    for (const item of items) {
      const lockedVariants = await tx.$queryRaw<
        Array<{ id: number }>
      >`
        SELECT id
        FROM product_variants
        WHERE id = ${item.variantId}
        FOR UPDATE
      `;

      if (lockedVariants.length !== 1) {
        throw this.conflict(
          'SKU cần hoàn tồn không tồn tại.',
        );
      }

      const originalInput = this.deductionInput(
        orderId,
        item,
      );

      const original =
        await this.ledger.findRecordedOperation(
          tx,
          originalInput,
        );

      if (!original) {
        throw this.conflict(
          'Không tìm thấy chứng từ trừ tồn gốc.',
        );
      }

      const releaseInput: PendingMovementInput = {
        operationKey:
          `M03-ORDER-${orderId}-SKU-${item.variantId}-RELEASE`,
        variantId: item.variantId,
        orderId,
        delta: -original.delta,
        reason,
        refType: 'ORDER',
        refId: orderId,
      };

      const previousMovement =
        await tx.inventoryMovement.findUnique({
          where: {
            operationKey: releaseInput.operationKey,
          },
          select: {
            reason: true,
          },
        });

      if (previousMovement) {
        if (
          previousMovement.reason !==
            InventoryReason.ORDER_CANCELLED &&
          previousMovement.reason !==
            InventoryReason.PAYMENT_EXPIRED
        ) {
          throw this.conflict(
            'Chứng từ hoàn tồn không hợp lệ.',
          );
        }

        // Both cancellation reasons share one release key.
        // Validate a replay using the original stored reason.
        releaseInput.reason = previousMovement.reason;
      }

      const existing =
        await this.ledger.findRecordedOperation(
          tx,
          releaseInput,
        );

      if (existing) {
        results.push({
          ...existing,
          replayed: true,
        });

        continue;
      }

      if (!sourceChecked) {
        const sourceLink =
          await tx.kiotvietOrderLink.findUnique({
            where: { orderId },
          });

        const outboxCount = await tx.syncOutbox.count({
          where: { orderId },
        });

        const syncLogCount = await tx.syncLog.count({
          where: { orderId },
        });

        const sourceInvoiceCount =
          await tx.sourceInvoice.count({
            where: { webOrderId: orderId },
          });

        if (
          sourceLink ||
          outboxCount > 0 ||
          syncLogCount > 0 ||
          sourceInvoiceCount > 0
        ) {
          throw this.conflict(
            'Đơn có dấu vết đồng bộ nguồn. Cần đối soát trước khi hoàn tồn.',
          );
        }

        sourceChecked = true;
      }

      const originalEffect =
        await tx.pendingInventoryEffect.findUnique({
          where: {
            operationKey: originalInput.operationKey,
          },
        });

      const originalMovement =
        await tx.inventoryMovement.findUnique({
          where: {
            operationKey: originalInput.operationKey,
          },
        });

      if (
        !originalEffect ||
        !originalMovement ||
        originalEffect.status !== SyncState.PENDING ||
        originalEffect.releasedAt !== null ||
        originalEffect.sourceDocumentId !== null ||
        originalEffect.sourceAcknowledgedAt !== null ||
        originalMovement.sourceDocumentId !== null
      ) {
        throw this.conflict(
          'Chứng từ trừ tồn cần được đối soát nguồn.',
        );
      }

      const otherRelease =
        await tx.inventoryMovement.findFirst({
          where: {
            variantId: item.variantId,
            refType: 'ORDER',
            refId: orderId,
            reason: {
              in: [
                InventoryReason.ORDER_CANCELLED,
                InventoryReason.PAYMENT_EXPIRED,
              ],
            },
            operationKey: {
              not: releaseInput.operationKey,
            },
          },
          select: { id: true },
        });

      if (otherRelease) {
        throw this.conflict(
          'Đơn hàng có chứng từ hoàn tồn khác.',
        );
      }

      const lockedInventory = await tx.$queryRaw<
        Array<{
          quantity: number;
          version: number;
          syncStatus: SyncState;
        }>
      >`
        SELECT quantity, version, syncStatus
        FROM inventories
        WHERE variantId = ${item.variantId}
        FOR UPDATE
      `;

      const inventory = lockedInventory[0];

      if (!inventory) {
        throw new NotFoundException(
          apiErrorPayload(
            ErrorCode.NOT_FOUND,
            'Bản ghi tồn kho không tồn tại.',
          ),
        );
      }

      if (
        inventory.syncStatus ===
        SyncState.NEEDS_RECONCILIATION
      ) {
        throw this.conflict(
          'Tồn kho đang cần đối soát nguồn.',
        );
      }

      if (
        !this.validPositiveInt(inventory.version) ||
        inventory.version >= 2147483647
      ) {
        throw this.conflict(
          'Version tồn kho vượt giới hạn cập nhật.',
        );
      }

      if (
        inventory.quantity < 0 ||
        inventory.quantity >
          2147483647 - releaseInput.delta
      ) {
        throw this.conflict(
          'Số lượng tồn kho vượt giới hạn hoàn tồn.',
        );
      }

      const changed = await tx.inventory.updateMany({
        where: {
          variantId: item.variantId,
          version: inventory.version,
          quantity: inventory.quantity,
        },
        data: {
          quantity: {
            increment: releaseInput.delta,
          },
          version: {
            increment: 1,
          },
          syncStatus: SyncState.PENDING,
        },
      });

      if (changed.count !== 1) {
        throw this.conflict(
          'Tồn kho đã thay đổi. Vui lòng kiểm tra lại.',
        );
      }

      const recorded =
        await this.ledger.appendPendingMovement(
          tx,
          releaseInput,
          inventory.version + 1,
        );

      results.push({
        ...recorded,
        replayed: false,
      });
    }

    return results;
  }
}
