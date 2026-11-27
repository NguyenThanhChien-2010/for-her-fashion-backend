import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, SyncState } from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

export interface PendingEffectIdentity {
  operationKey: string;
  variantId: number;
  expectedVersion: number;
}

export interface ConfirmPendingEffectInput
  extends PendingEffectIdentity {
  sourceDocumentId: string;
  acknowledgedAt: Date;
}

export interface PendingEffectResult {
  id: string;
  operationKey: string;
  variantId: number;
  delta: number;
  status: SyncState;
  version: number;
  replayed: boolean;
}

@Injectable()
export class PendingInventoryEffectService {
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

  private versionConflict(): ConflictException {
    return new ConflictException(
      apiErrorPayload(
        ErrorCode.VERSION_CONFLICT,
        'Phiên bản tác động chờ đã thay đổi.',
      ),
    );
  }

  private isPositiveInt(value: number): boolean {
    return (
      Number.isInteger(value) &&
      value > 0 &&
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

  private validate(input: PendingEffectIdentity): void {
    if (!this.validString(input.operationKey, 191)) {
      throw this.badRequest('operationKey không hợp lệ.');
    }

    if (!this.isPositiveInt(input.variantId)) {
      throw this.badRequest('variantId không hợp lệ.');
    }

    if (!this.isPositiveInt(input.expectedVersion)) {
      throw this.badRequest('Phiên bản không hợp lệ.');
    }
  }

  private async load(
    tx: Prisma.TransactionClient,
    input: PendingEffectIdentity,
  ) {
    this.validate(input);

    const effect =
      await tx.pendingInventoryEffect.findUnique({
        where: {
          operationKey: input.operationKey,
        },
      });

    if (
      !effect ||
      effect.operationKey !== input.operationKey ||
      effect.variantId !== input.variantId
    ) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Tác động chờ không tồn tại.',
        ),
      );
    }

    const movement =
      await tx.inventoryMovement.findUnique({
        where: {
          operationKey: input.operationKey,
        },
      });

    if (
      !movement ||
      movement.operationKey !== effect.operationKey ||
      movement.variantId !== effect.variantId ||
      movement.delta !== effect.delta
    ) {
      throw this.conflict(
        'Sổ biến động và tác động chờ không nhất quán.',
      );
    }

    if (effect.status === SyncState.CONFIRMED) {
      if (
        !effect.releasedAt ||
        !effect.sourceAcknowledgedAt ||
        !effect.sourceDocumentId ||
        movement.sourceDocumentId !== effect.sourceDocumentId
      ) {
        throw this.conflict(
          'Dữ liệu xác nhận nguồn không nhất quán.',
        );
      }
    } else if (effect.releasedAt !== null) {
      throw this.conflict(
        'Tác động chưa xác nhận đã bị giải phóng.',
      );
    }

    return { effect, movement };
  }

  private checkVersion(
    version: number,
    expectedVersion: number,
  ): void {
    if (version !== expectedVersion) {
      throw this.versionConflict();
    }

    if (version >= 2147483647) {
      throw this.conflict(
        'Phiên bản đã vượt giới hạn cập nhật.',
      );
    }
  }

  private toResult(
    effect: {
      id: bigint;
      operationKey: string;
      variantId: number;
      delta: number;
      status: SyncState;
      version: number;
    },
    replayed: boolean,
  ): PendingEffectResult {
    return {
      id: String(effect.id),
      operationKey: effect.operationKey,
      variantId: effect.variantId,
      delta: effect.delta,
      status: effect.status,
      version: effect.version,
      replayed,
    };
  }

  /**
   * Internal transaction primitive.
   * Caller must lock the SKU and update inventory sync state
   * in the same transaction.
   */
  async markNeedsReconciliation(
    tx: Prisma.TransactionClient,
    input: PendingEffectIdentity,
  ): Promise<PendingEffectResult> {
    const { effect } = await this.load(tx, input);

    if (effect.status === SyncState.CONFIRMED) {
      throw this.conflict(
        'Không được mở lại tác động đã xác nhận.',
      );
    }

    if (
      effect.status === SyncState.NEEDS_RECONCILIATION
    ) {
      return this.toResult(effect, true);
    }

    this.checkVersion(
      effect.version,
      input.expectedVersion,
    );

    const updated =
      await tx.pendingInventoryEffect.updateMany({
        where: {
          id: effect.id,
          variantId: input.variantId,
          version: input.expectedVersion,
          status: SyncState.PENDING,
          releasedAt: null,
        },
        data: {
          status: SyncState.NEEDS_RECONCILIATION,
          version: { increment: 1 },
        },
      });

    if (updated.count !== 1) {
      throw this.versionConflict();
    }

    return this.toResult(
      {
        ...effect,
        status: SyncState.NEEDS_RECONCILIATION,
        version: effect.version + 1,
      },
      false,
    );
  }

  /**
   * Internal transaction primitive.
   *
   * Caller must:
   * - Verify source evidence through M08.
   * - Lock the SKU before reading source state.
   * - Release only the verified operation.
   * - Reconcile source quantity and remaining effects.
   * - Update Inventory within the same transaction.
   *
   * Never commit this method in isolation.
   */
  async releaseConfirmed(
    tx: Prisma.TransactionClient,
    input: ConfirmPendingEffectInput,
  ): Promise<PendingEffectResult> {
    this.validate(input);

    if (!this.validString(input.sourceDocumentId, 100)) {
      throw this.badRequest(
        'Mã chứng từ nguồn không hợp lệ.',
      );
    }

    if (
      !(input.acknowledgedAt instanceof Date) ||
      !Number.isFinite(input.acknowledgedAt.getTime()) ||
      input.acknowledgedAt.getTime() > Date.now()
    ) {
      throw this.badRequest(
        'Thời điểm xác nhận nguồn không hợp lệ.',
      );
    }

    const { effect, movement } =
      await this.load(tx, input);

    if (
      (
        effect.sourceDocumentId !== null &&
        effect.sourceDocumentId !== input.sourceDocumentId
      ) ||
      (
        movement.sourceDocumentId !== null &&
        movement.sourceDocumentId !== input.sourceDocumentId
      )
    ) {
      throw this.conflict(
        'Mã chứng từ nguồn không khớp nghiệp vụ.',
      );
    }

    if (effect.status === SyncState.CONFIRMED) {
      return this.toResult(effect, true);
    }

    this.checkVersion(
      effect.version,
      input.expectedVersion,
    );

    const releasedAt = new Date();

    const updated =
      await tx.pendingInventoryEffect.updateMany({
        where: {
          id: effect.id,
          variantId: input.variantId,
          version: input.expectedVersion,
          status: {
            in: [
              SyncState.PENDING,
              SyncState.NEEDS_RECONCILIATION,
            ],
          },
          releasedAt: null,
        },
        data: {
          status: SyncState.CONFIRMED,
          sourceDocumentId: input.sourceDocumentId,
          sourceAcknowledgedAt:
            effect.sourceAcknowledgedAt ??
            input.acknowledgedAt,
          releasedAt,
          version: { increment: 1 },
        },
      });

    if (updated.count !== 1) {
      throw this.versionConflict();
    }

    const movementUpdated =
      await tx.inventoryMovement.updateMany({
        where: {
          id: movement.id,
          variantId: input.variantId,
          OR: [
            { sourceDocumentId: null },
            {
              sourceDocumentId:
                input.sourceDocumentId,
            },
          ],
        },
        data: {
          sourceDocumentId: input.sourceDocumentId,
        },
      });

    if (movementUpdated.count !== 1) {
      throw this.conflict(
        'Không thể cập nhật chứng từ nguồn.',
      );
    }

    return this.toResult(
      {
        ...effect,
        status: SyncState.CONFIRMED,
        version: effect.version + 1,
      },
      false,
    );
  }
}
