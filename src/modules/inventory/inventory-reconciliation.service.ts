import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
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

import { PrismaService } from '../prisma/prisma.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';

export interface ReconciliationIdentity {
  adjustmentId: number;
  variantId: number;
  expectedInventoryVersion: number;
}

export interface VerifiedPendingEffect {
  operationKey: string;
  expectedVersion: number;
  sourceDocumentId: string;
}

export interface VerifiedAdjustmentResult
  extends ReconciliationIdentity {
  sourceVariantId: string;
  sourceDocumentId: string;
  sourceVersion: string;
  sourceQuantity: number;
  observedAt: Date;
  confirmedEffects: VerifiedPendingEffect[];
}

@Injectable()
export class InventoryReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pendingEffects: PendingInventoryEffectService,
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

  private notFound(message: string): NotFoundException {
    return new NotFoundException(
      apiErrorPayload(ErrorCode.NOT_FOUND, message),
    );
  }

  private businessViolation(
    message: string,
  ): UnprocessableEntityException {
    return new UnprocessableEntityException(
      apiErrorPayload(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        message,
      ),
    );
  }

  private validInteger(value: number, min = 1): boolean {
    return (
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= 2147483647
    );
  }

  private validString(value: string, max: number): boolean {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= max &&
      value.trim() === value
    );
  }

  private validateIdentity(
    input: ReconciliationIdentity,
  ): void {
    if (
      !this.validInteger(input.adjustmentId) ||
      !this.validInteger(input.variantId) ||
      !this.validInteger(input.expectedInventoryVersion)
    ) {
      throw this.badRequest(
        'ID hoặc phiên bản đối chiếu không hợp lệ.',
      );
    }
  }

  private validateResult(
    input: VerifiedAdjustmentResult,
  ): void {
    this.validateIdentity(input);

    if (
      !this.validString(input.sourceVariantId, 64) ||
      !this.validString(input.sourceDocumentId, 100) ||
      !this.validString(input.sourceVersion, 100) ||
      !this.validInteger(input.sourceQuantity, 0)
    ) {
      throw this.badRequest(
        'Dữ liệu xác nhận nguồn không hợp lệ.',
      );
    }

    if (
      !(input.observedAt instanceof Date) ||
      !Number.isFinite(input.observedAt.getTime()) ||
      input.observedAt.getTime() > Date.now()
    ) {
      throw this.badRequest(
        'Thời điểm đối chiếu không hợp lệ.',
      );
    }

    if (!Array.isArray(input.confirmedEffects)) {
      throw this.badRequest(
        'Danh sách tác động xác nhận không hợp lệ.',
      );
    }

    const keys = new Set<string>();

    for (const effect of input.confirmedEffects) {
      if (
        !effect ||
        !this.validString(effect.operationKey, 191) ||
        !this.validInteger(effect.expectedVersion) ||
        !this.validString(effect.sourceDocumentId, 100) ||
        keys.has(effect.operationKey)
      ) {
        throw this.badRequest(
          'Tác động xác nhận không hợp lệ hoặc bị trùng.',
        );
      }

      keys.add(effect.operationKey);
    }
  }

  private checkVersion(
    current: number,
    expected: number,
  ): void {
    if (current !== expected) {
      throw new ConflictException(
        apiErrorPayload(
          ErrorCode.VERSION_CONFLICT,
          'Tồn kho đã thay đổi. Cần đối chiếu lại.',
        ),
      );
    }

    if (current >= 2147483647) {
      throw this.conflict(
        'Version đã vượt giới hạn cập nhật.',
      );
    }
  }

  private async lockContext(
    tx: Prisma.TransactionClient,
    input: ReconciliationIdentity,
  ) {
    const locked = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM product_variants
      WHERE id = ${input.variantId}
      FOR UPDATE
    `;

    if (locked.length !== 1) {
      throw this.notFound('SKU không tồn tại.');
    }

    const variant = await tx.productVariant.findUnique({
      where: { id: input.variantId },
      select: {
        id: true,
        kiotvietVariantId: true,
      },
    });

    if (!variant?.kiotvietVariantId) {
      throw this.businessViolation(
        'SKU chưa có liên kết KiotViet.',
      );
    }

    const lockedInventory = await tx.$queryRaw<
      Array<{ version: number }>
    >`
      SELECT version
      FROM inventories
      WHERE variantId = ${input.variantId}
      FOR UPDATE
    `;

    if (lockedInventory.length !== 1) {
      throw this.notFound('Tồn kho không tồn tại.');
    }

    const inventory = await tx.inventory.findUniqueOrThrow({
      where: { variantId: input.variantId },
    });

    const adjustment = await tx.inventoryAdjustment.findUnique({
      where: { id: input.adjustmentId },
    });

    if (
      !adjustment ||
      adjustment.variantId !== input.variantId
    ) {
      throw this.notFound(
        'Yêu cầu điều chỉnh không tồn tại.',
      );
    }

    return { variant, inventory, adjustment };
  }

  /**
   * Internal M08 integration only.
   * Source evidence must be verified before calling.
   * Never expose this method directly to HTTP clients.
   */
  async confirmAdjustment(input: VerifiedAdjustmentResult) {
    this.validateResult(input);

    return this.prisma.$transaction(async tx => {
      const { variant, inventory, adjustment } =
        await this.lockContext(tx, input);

      if (variant.kiotvietVariantId !== input.sourceVariantId) {
        throw this.conflict(
          'SKU nguồn không khớp.',
        );
      }

      // Idempotent replay before checking local version.
      if (adjustment.status === SyncState.CONFIRMED) {
        if (
          adjustment.sourceDocumentId !== input.sourceDocumentId ||
          adjustment.sourceVersion !== input.sourceVersion ||
          adjustment.resultQuantity !== input.sourceQuantity
        ) {
          throw this.conflict(
            'Kết quả đã xác nhận không được ghi đè.',
          );
        }

        for (const item of input.confirmedEffects) {
          const effect =
            await tx.pendingInventoryEffect.findUnique({
              where: { operationKey: item.operationKey },
            });

          if (
            !effect ||
            effect.variantId !== input.variantId ||
            effect.status !== SyncState.CONFIRMED ||
            !effect.releasedAt ||
            effect.sourceDocumentId !== item.sourceDocumentId
          ) {
            throw this.conflict(
              'Yêu cầu lặp chứa tác động chưa xác nhận.',
            );
          }
        }

        return {
          adjustment,
          inventory,
          replayed: true,
        };
      }

      this.checkVersion(
        inventory.version,
        input.expectedInventoryVersion,
      );

      if (
        inventory.lastConfirmedAt &&
        input.observedAt <= inventory.lastConfirmedAt
      ) {
        throw this.conflict(
          'Dữ liệu nguồn không mới hơn lần xác nhận trước.',
        );
      }

      if (inventory.sourceVersion === input.sourceVersion) {
        throw this.conflict(
          'Phiên bản nguồn đã được sử dụng.',
        );
      }

      const previous = await tx.inventoryAdjustment.findFirst({
        where: {
          variantId: input.variantId,
          sourceDocumentId: input.sourceDocumentId,
          status: SyncState.CONFIRMED,
          id: { not: input.adjustmentId },
        },
      });

      if (previous) {
        throw this.conflict(
          'Chứng từ nguồn đã được áp dụng.',
        );
      }

      // Release only operations verified by M08.
      for (const effect of input.confirmedEffects) {
        await this.pendingEffects.releaseConfirmed(tx, {
          operationKey: effect.operationKey,
          variantId: input.variantId,
          expectedVersion: effect.expectedVersion,
          sourceDocumentId: effect.sourceDocumentId,
          acknowledgedAt: input.observedAt,
        });
      }

      const remaining = await tx.pendingInventoryEffect.findMany({
        where: {
          variantId: input.variantId,
          releasedAt: null,
          status: {
            in: [
              SyncState.PENDING,
              SyncState.NEEDS_RECONCILIATION,
            ],
          },
        },
        select: {
          delta: true,
          status: true,
        },
      });

      const pendingDelta = remaining.reduce(
        (sum, effect) => sum + BigInt(effect.delta),
        BigInt(0),
      );

      const calculated =
        BigInt(input.sourceQuantity) + pendingDelta;

      if (calculated > BigInt(2147483647)) {
        throw this.conflict(
          'Tồn bán vượt giới hạn hỗ trợ.',
        );
      }

      const quantity =
        calculated < BigInt(0) ? 0 : Number(calculated);

      const needsReconciliation =
        calculated < BigInt(0) ||
        remaining.some(
          effect =>
            effect.status === SyncState.NEEDS_RECONCILIATION,
        );

      const syncStatus = needsReconciliation
        ? SyncState.NEEDS_RECONCILIATION
        : remaining.length > 0
          ? SyncState.PENDING
          : SyncState.CONFIRMED;

      const updatedInventory = await tx.inventory.update({
        where: { variantId: input.variantId },
        data: {
          quantity,
          sourceQuantity: input.sourceQuantity,
          sourceVersion: input.sourceVersion,
          lastConfirmedAt: input.observedAt,
          syncStatus,
          version: { increment: 1 },
        },
      });

      await tx.inventoryMovement.create({
        data: {
          operationKey: adjustment.operationKey,
          variantId: input.variantId,
          inventoryVersion: updatedInventory.version,
          delta: quantity - inventory.quantity,
          reason: InventoryReason.ADMIN_ADJUST,
          refType: 'INVENTORY_ADJUSTMENT',
          refId: adjustment.id,
          createdBy: adjustment.actorId,
          note: Array.from(adjustment.reason)
            .slice(0, 255)
            .join(''),
          sourceDocumentId: input.sourceDocumentId,
        },
      });

      const updatedAdjustment =
        await tx.inventoryAdjustment.update({
          where: { id: adjustment.id },
          data: {
            status: SyncState.CONFIRMED,
            sourceDocumentId: input.sourceDocumentId,
            sourceVersion: input.sourceVersion,
            resultQuantity: input.sourceQuantity,
            confirmedAt: input.observedAt,
          },
        });

      return {
        adjustment: updatedAdjustment,
        inventory: updatedInventory,
        replayed: false,
      };
    }, {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10000,
      timeout: 20000,
    });
  }

  async markNeedsReconciliation(
    input: ReconciliationIdentity,
  ) {
    this.validateIdentity(input);

    return this.prisma.$transaction(async tx => {
      const { inventory, adjustment } =
        await this.lockContext(tx, input);

      if (adjustment.status === SyncState.CONFIRMED) {
        throw this.conflict(
          'Không được mở lại điều chỉnh đã xác nhận.',
        );
      }

      if (
        adjustment.status === SyncState.NEEDS_RECONCILIATION &&
        inventory.syncStatus === SyncState.NEEDS_RECONCILIATION
      ) {
        return {
          adjustment,
          inventory,
          replayed: true,
        };
      }

      this.checkVersion(
        inventory.version,
        input.expectedInventoryVersion,
      );

      const updatedAdjustment =
        await tx.inventoryAdjustment.update({
          where: { id: adjustment.id },
          data: {
            status: SyncState.NEEDS_RECONCILIATION,
          },
        });

      const updatedInventory = await tx.inventory.update({
        where: { variantId: input.variantId },
        data: {
          syncStatus: SyncState.NEEDS_RECONCILIATION,
          version: { increment: 1 },
        },
      });

      return {
        adjustment: updatedAdjustment,
        inventory: updatedInventory,
        replayed: false,
      };
    }, {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10000,
      timeout: 20000,
    });
  }
}
