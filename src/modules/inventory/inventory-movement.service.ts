import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import { PrismaService } from '../prisma/prisma.service';

export interface InventoryMovementQuery {
  page?: string;
  limit?: string;
}

export interface InventoryMovementItem {
  id: string;
  variantId: string;
  delta: number;
  reason: string;
  sourceReference: string | null;
  occurredAt: string;
}

export interface InventoryMovementListResponse {
  items: InventoryMovementItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

@Injectable()
export class InventoryMovementService {
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

  private parsePositiveInteger(
    value: string,
    field: string,
    max = 2147483647,
  ): number {
    if (
      typeof value !== 'string' ||
      !/^[1-9][0-9]*$/.test(value)
    ) {
      throw this.badRequest(
        `${field} phải là số nguyên dương.`,
      );
    }

    const result = Number(value);

    if (
      !Number.isSafeInteger(result) ||
      result > max
    ) {
      throw this.badRequest(
        `${field} vượt phạm vi hỗ trợ.`,
      );
    }

    return result;
  }

  async findAll(
    variantIdValue: string,
    query: InventoryMovementQuery = {},
  ): Promise<InventoryMovementListResponse> {
    const variantId = this.parsePositiveInteger(
      variantIdValue,
      'variantId',
    );

    if (
      Object.keys(query).some(
        (key) => !['page', 'limit'].includes(key),
      )
    ) {
      throw this.badRequest(
        'Tham số truy vấn không hợp lệ.',
      );
    }

    const page =
      query.page === undefined
        ? 1
        : this.parsePositiveInteger(
            query.page,
            'page',
          );

    const limit =
      query.limit === undefined
        ? 20
        : this.parsePositiveInteger(
            query.limit,
            'limit',
            100,
          );

    const offset = (page - 1) * limit;

    if (
      !Number.isSafeInteger(offset) ||
      offset > 2147483647
    ) {
      throw this.badRequest(
        'Phân trang vượt phạm vi hỗ trợ.',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const variant =
          await tx.productVariant.findUnique({
            where: {
              id: variantId,
            },
            select: {
              id: true,
            },
          });

        if (!variant) {
          throw new NotFoundException(
            apiErrorPayload(
              ErrorCode.NOT_FOUND,
              'Biến thể không tồn tại.',
            ),
          );
        }

        const where = {
          variantId,
        };

        const total =
          await tx.inventoryMovement.count({
            where,
          });

        const movements =
          await tx.inventoryMovement.findMany({
            where,
            skip: offset,
            take: limit,
            orderBy: [
              {
                createdAt: 'desc',
              },
              {
                id: 'desc',
              },
            ],
            select: {
              id: true,
              variantId: true,
              delta: true,
              reason: true,
              note: true,
              sourceDocumentId: true,
              createdAt: true,
            },
          });

        const items: InventoryMovementItem[] =
          movements.map((movement) => {
            const note = movement.note?.trim();

            return {
              id: String(movement.id),
              variantId: String(
                movement.variantId,
              ),
              delta: movement.delta,
              reason: note
                ? `${movement.reason}: ${note}`
                : movement.reason,
              sourceReference:
                movement.sourceDocumentId ?? null,
              occurredAt:
                movement.createdAt.toISOString(),
            };
          });

        return {
          items,
          pagination: {
            page,
            limit,
            total,
          },
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }
}
