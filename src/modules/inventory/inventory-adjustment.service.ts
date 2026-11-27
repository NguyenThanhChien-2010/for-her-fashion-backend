import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { createHash } from 'node:crypto';

import { Prisma, SyncState } from '@prisma/client';

import type { InventoryAdjustment } from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import { PrismaService } from '../prisma/prisma.service';

export interface InventoryAdjustmentRequest {
  variantId: string;
  version: number;
  countedQuantity: number;
  reason: string;
}

export interface InventoryAdjustmentResponse {
  id: string;
  variantId: string;
  countedQuantity: number;
  reason: string;
  status: SyncState;
  sourceReference: string | null;
  version: number;
}

@Injectable()
export class InventoryAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
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

  private notFound(
    message: string,
  ): NotFoundException {
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

  private isInteger(
    value: unknown,
    min: number,
  ): value is number {
    return (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= 2147483647
    );
  }

  private parseId(
    value: unknown,
    field: string,
  ): number {
    if (
      typeof value !== 'string' ||
      !/^[1-9][0-9]*$/.test(value)
    ) {
      throw this.badRequest(
        `${field} phải là số nguyên dương.`,
      );
    }

    const id = Number(value);

    if (!this.isInteger(id, 1)) {
      throw this.badRequest(
        `${field} vượt phạm vi hỗ trợ.`,
      );
    }

    return id;
  }

  private validate(
    body: unknown,
  ): InventoryAdjustmentRequest {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      throw this.badRequest(
        'Dữ liệu điều chỉnh không hợp lệ.',
      );
    }

    const input = body as Record<string, unknown>;

    const allowed = [
      'variantId',
      'version',
      'countedQuantity',
      'reason',
    ];

    if (
      Object.keys(input).some(
        key => !allowed.includes(key),
      )
    ) {
      throw this.badRequest(
        'Có trường dữ liệu không được hỗ trợ.',
      );
    }

    const variantId = this.parseId(
      input.variantId,
      'variantId',
    );

    if (!this.isInteger(input.version, 1)) {
      throw this.badRequest(
        'Version phải là số nguyên dương.',
      );
    }

    if (!this.isInteger(input.countedQuantity, 0)) {
      throw this.badRequest(
        'Số lượng kiểm đếm không hợp lệ.',
      );
    }

    if (
      typeof input.reason !== 'string' ||
      input.reason.trim().length === 0 ||
      Array.from(input.reason).length > 2000
    ) {
      throw this.badRequest(
        'Lý do phải có từ 1 đến 2000 ký tự.',
      );
    }

    return {
      variantId: String(variantId),
      version: input.version,
      countedQuantity: input.countedQuantity,
      reason: input.reason,
    };
  }

  private makeOperationKey(
    actorId: number,
    idempotencyKey: unknown,
  ): string {
    if (!this.isInteger(actorId, 1)) {
      throw this.badRequest(
        'Người thực hiện không hợp lệ.',
      );
    }

    if (
      typeof idempotencyKey !== 'string' ||
      Array.from(idempotencyKey).length < 16 ||
      Array.from(idempotencyKey).length > 128 ||
      idempotencyKey.trim() !== idempotencyKey
    ) {
      throw this.badRequest(
        'Idempotency-Key phải có từ 16 đến 128 ký tự.',
      );
    }

    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          actorId,
          'm03_post_admin_inventory_adjustments',
          idempotencyKey,
        ]),
      )
      .digest('hex');

    return `M03-ADJUST-${hash}`;
  }

  private toResponse(
    adjustment: InventoryAdjustment,
  ): InventoryAdjustmentResponse {
    return {
      id: String(adjustment.id),
      variantId: String(adjustment.variantId),
      countedQuantity: adjustment.requestedQuantity,
      reason: adjustment.reason,
      status: adjustment.status,
      sourceReference: adjustment.sourceDocumentId,
      version: adjustment.expectedVersion,
    };
  }

  private replay(
    adjustment: InventoryAdjustment,
    actorId: number,
    input: InventoryAdjustmentRequest,
  ): InventoryAdjustmentResponse {
    const matches =
      adjustment.actorId === actorId &&
      adjustment.variantId === Number(input.variantId) &&
      adjustment.expectedVersion === input.version &&
      adjustment.requestedQuantity === input.countedQuantity &&
      adjustment.reason === input.reason;

    if (!matches) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'Idempotency-Key đã được sử dụng với dữ liệu khác.',
        details: [],
      });
    }

    return this.toResponse(adjustment);
  }

  /**
   * Accept an adjustment request without changing stock.
   * actorId must come from the authenticated ADMIN/STAFF.
   */
  async create(
    actorId: number,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<InventoryAdjustmentResponse> {
    const input = this.validate(body);

    const operationKey = this.makeOperationKey(
      actorId,
      idempotencyKey,
    );

    const variantId = Number(input.variantId);

    try {
      return await this.prisma.$transaction(
        async tx => {
          const existing =
            await tx.inventoryAdjustment.findUnique({
              where: { operationKey },
            });

          if (existing) {
            return this.replay(
              existing,
              actorId,
              input,
            );
          }

          // Lock the SKU before checking inventory version.
          const lockedVariants =
            await tx.$queryRaw<Array<{ id: number }>>`
              SELECT id
              FROM product_variants
              WHERE id = ${variantId}
              FOR UPDATE
            `;

          if (lockedVariants.length !== 1) {
            throw this.notFound(
              'Biến thể không tồn tại.',
            );
          }

          // Recheck after acquiring the SKU lock.
          const recorded =
            await tx.inventoryAdjustment.findUnique({
              where: { operationKey },
            });

          if (recorded) {
            return this.replay(
              recorded,
              actorId,
              input,
            );
          }

          const variant =
            await tx.productVariant.findUnique({
              where: { id: variantId },
              select: {
                id: true,
                kiotvietVariantId: true,
              },
            });

          if (!variant) {
            throw this.notFound(
              'Biến thể không tồn tại.',
            );
          }

          if (!variant.kiotvietVariantId?.trim()) {
            throw this.businessViolation(
              'SKU chưa có liên kết nguồn KiotViet.',
            );
          }

          const lockedInventory =
            await tx.$queryRaw<Array<{ version: number }>>`
              SELECT version
              FROM inventories
              WHERE variantId = ${variantId}
              FOR UPDATE
            `;

          if (lockedInventory.length !== 1) {
            throw this.businessViolation(
              'SKU chưa có bản ghi tồn kho để đối chiếu.',
            );
          }

          if (
            lockedInventory[0].version !== input.version
          ) {
            throw new ConflictException(
              apiErrorPayload(
                ErrorCode.VERSION_CONFLICT,
                'Phiên bản tồn kho đã thay đổi.',
              ),
            );
          }

          const adjustment =
            await tx.inventoryAdjustment.create({
              data: {
                operationKey,
                variantId,
                expectedVersion: input.version,
                requestedQuantity:
                  input.countedQuantity,
                reason: input.reason,
                actorId,
                status: SyncState.PENDING,
              },
            });

          return this.toResponse(adjustment);
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10000,
          timeout: 20000,
        },
      );
    } catch (error) {
      // Concurrent requests using the same durable key.
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          await this.prisma.inventoryAdjustment.findUnique({
            where: { operationKey },
          });

        if (existing) {
          return this.replay(
            existing,
            actorId,
            input,
          );
        }
      }

      throw error;
    }
  }

  /**
   * Return the current adjustment reconciliation status.
   */
  async findOne(
    adjustmentId: string,
  ): Promise<InventoryAdjustmentResponse> {
    const id = this.parseId(
      adjustmentId,
      'adjustmentId',
    );

    const adjustment =
      await this.prisma.inventoryAdjustment.findUnique({
        where: { id },
      });

    if (!adjustment) {
      throw this.notFound(
        'Yêu cầu điều chỉnh không tồn tại.',
      );
    }

    return this.toResponse(adjustment);
  }
}
