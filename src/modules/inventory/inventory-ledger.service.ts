import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  InventoryReason,
  Prisma,
  SyncState,
} from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

export interface PendingMovementInput {
  operationKey: string;
  variantId: number;
  orderId: number;
  delta: number;
  reason: InventoryReason;
  note?: string | null;
  refType?: string | null;
  refId?: number | null;
  createdBy?: number | null;
}

export interface RecordedInventoryOperation {
  operationKey: string;
  variantId: number;
  movementId: string;
  pendingEffectId: string;
  inventoryVersion: number;
  delta: number;
}

@Injectable()
export class InventoryLedgerService {
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

  private isPositiveInt(value: number): boolean {
    return (
      Number.isInteger(value) &&
      value > 0 &&
      value <= 2147483647
    );
  }

  private validate(input: PendingMovementInput): void {
    if (
      typeof input.operationKey !== 'string' ||
      input.operationKey.length === 0 ||
      input.operationKey.length > 191 ||
      input.operationKey.trim() !== input.operationKey
    ) {
      throw this.badRequest(
        'operationKey không hợp lệ.',
      );
    }

    if (
      !this.isPositiveInt(input.variantId) ||
      !this.isPositiveInt(input.orderId)
    ) {
      throw this.badRequest(
        'variantId hoặc orderId không hợp lệ.',
      );
    }

    if (
      !Number.isInteger(input.delta) ||
      input.delta === 0 ||
      input.delta < -2147483647 ||
      input.delta > 2147483647
    ) {
      throw this.badRequest(
        'Số lượng biến động không hợp lệ.',
      );
    }

    switch (input.reason) {
      case InventoryReason.ORDER_CREATED:
        if (input.delta >= 0) {
          throw this.badRequest(
            'Tạo đơn phải có biến động âm.',
          );
        }
        break;

      case InventoryReason.ORDER_CANCELLED:
      case InventoryReason.PAYMENT_EXPIRED:
      case InventoryReason.RETURN_RECEIVED:
        if (input.delta <= 0) {
          throw this.badRequest(
            'Hoàn tồn phải có biến động dương.',
          );
        }
        break;

      default:
        throw this.badRequest(
          'Loại biến động không được hỗ trợ.',
        );
    }

    if (
      input.note != null &&
      (
        typeof input.note !== 'string' ||
        input.note.length > 255
      )
    ) {
      throw this.badRequest(
        'Ghi chú không hợp lệ.',
      );
    }

    if (
      input.refType != null &&
      (
        typeof input.refType !== 'string' ||
        input.refType.length > 30
      )
    ) {
      throw this.badRequest(
        'Loại tham chiếu không hợp lệ.',
      );
    }

    if (
      input.refId != null &&
      !this.isPositiveInt(input.refId)
    ) {
      throw this.badRequest(
        'refId không hợp lệ.',
      );
    }

    if (
      input.createdBy != null &&
      !this.isPositiveInt(input.createdBy)
    ) {
      throw this.badRequest(
        'createdBy không hợp lệ.',
      );
    }
  }

  /**
   * Must be called before applying a stock mutation.
   * An existing matching operation must not be applied again.
   */
  async findRecordedOperation(
    tx: Prisma.TransactionClient,
    input: PendingMovementInput,
  ): Promise<RecordedInventoryOperation | null> {
    this.validate(input);

    const movement =
      await tx.inventoryMovement.findUnique({
        where: {
          operationKey: input.operationKey,
        },
      });

    const effect =
      await tx.pendingInventoryEffect.findUnique({
        where: {
          operationKey: input.operationKey,
        },
      });

    if (!movement && !effect) {
      return null;
    }

    if (!movement || !effect) {
      throw this.conflict(
        'Sổ biến động và tác động chờ không nhất quán.',
      );
    }

    const matches =
      movement.operationKey === input.operationKey &&
      effect.operationKey === input.operationKey &&
      movement.variantId === input.variantId &&
      effect.variantId === input.variantId &&
      effect.orderId === input.orderId &&
      movement.delta === input.delta &&
      effect.delta === input.delta &&
      movement.reason === input.reason &&
      movement.note === (input.note ?? null) &&
      movement.refType === (input.refType ?? null) &&
      movement.refId === (input.refId ?? null) &&
      movement.createdBy === (input.createdBy ?? null);

    if (!matches) {
      throw this.conflict(
        'Mã nghiệp vụ đã được sử dụng với dữ liệu khác.',
      );
    }

    return {
      operationKey: movement.operationKey,
      variantId: movement.variantId,
      movementId: String(movement.id),
      pendingEffectId: String(effect.id),
      inventoryVersion: movement.inventoryVersion,
      delta: movement.delta,
    };
  }

  /**
   * The caller must already have:
   * 1. Checked the operation key.
   * 2. Applied the stock mutation and version update.
   *
   * All steps must use the same transaction.
   * Any error must roll back the entire transaction.
   */
  async appendPendingMovement(
    tx: Prisma.TransactionClient,
    input: PendingMovementInput,
    inventoryVersion: number,
  ): Promise<RecordedInventoryOperation> {
    this.validate(input);

    if (!this.isPositiveInt(inventoryVersion)) {
      throw this.badRequest(
        'Phiên bản tồn kho không hợp lệ.',
      );
    }

    const existing = await this.findRecordedOperation(
      tx,
      input,
    );

    if (existing) {
      throw this.conflict(
        'Nghiệp vụ đã được ghi nhận.',
      );
    }

    const inventory = await tx.inventory.findUnique({
      where: {
        variantId: input.variantId,
      },
      select: {
        version: true,
        quantity: true,
      },
    });

    if (!inventory) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Bản ghi tồn kho không tồn tại.',
        ),
      );
    }

    if (inventory.version !== inventoryVersion) {
      throw new ConflictException(
        apiErrorPayload(
          ErrorCode.VERSION_CONFLICT,
          'Phiên bản tồn kho đã thay đổi.',
        ),
      );
    }

    if (inventory.quantity < 0) {
      throw this.conflict(
        'Tồn bán không được âm.',
      );
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        operationKey: input.operationKey,
        variantId: input.variantId,
        delta: input.delta,
        reason: input.reason,
        inventoryVersion,
        note: input.note ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        createdBy: input.createdBy ?? null,
      },
    });

    const effect = await tx.pendingInventoryEffect.create({
      data: {
        operationKey: input.operationKey,
        variantId: input.variantId,
        orderId: input.orderId,
        delta: input.delta,
        status: SyncState.PENDING,
      },
    });

    return {
      operationKey: input.operationKey,
      variantId: input.variantId,
      movementId: String(movement.id),
      pendingEffectId: String(effect.id),
      inventoryVersion,
      delta: input.delta,
    };
  }
}
