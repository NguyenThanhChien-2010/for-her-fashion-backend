import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  Prisma,
  SyncState,
} from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import { PrismaService } from '../prisma/prisma.service';

export interface AdminInventoryQuery {
  q?: string;
  variantId?: string;
  page?: string;
  limit?: string;
}

export interface AdminInventoryItem {
  variantId: string;
  sku: string;
  availableQuantity: number;
  sourceQuantity: number | null;
  pendingDelta: number;
  syncStatus: SyncState;
  lastConfirmedAt: string | null;
  version: number;
}

export interface AdminInventoryListResponse {
  items: AdminInventoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

@Injectable()
export class AdminInventoryService {
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
    max: number = Number.MAX_SAFE_INTEGER,
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

  private parseKeyword(
    value?: string,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw this.badRequest(
        'q phải là chuỗi ký tự.',
      );
    }

    const keyword = value.trim();

    if (keyword.length > 255) {
      throw this.badRequest(
        'q không được vượt quá 255 ký tự.',
      );
    }

    return keyword.length > 0
      ? keyword
      : undefined;
  }

  async findAll(
    query: AdminInventoryQuery = {},
  ): Promise<AdminInventoryListResponse> {
    const allowedKeys = [
      'q',
      'variantId',
      'page',
      'limit',
    ];

    if (
      Object.keys(query).some(
        (key) => !allowedKeys.includes(key),
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

    const variantId =
      query.variantId === undefined
        ? undefined
        : this.parsePositiveInteger(
            query.variantId,
            'variantId',
            2147483647,
          );

    const keyword = this.parseKeyword(query.q);

    const offset = (page - 1) * limit;

    if (
      !Number.isSafeInteger(offset) ||
      offset > 2147483647
    ) {
      throw this.badRequest(
        'Phân trang vượt phạm vi hỗ trợ.',
      );
    }

    const where: Prisma.ProductVariantWhereInput = {};

    if (variantId !== undefined) {
      where.id = variantId;
    }

    if (keyword !== undefined) {
      where.OR = [
        {
          sku: {
            contains: keyword,
          },
        },
        {
          product: {
            is: {
              name: {
                contains: keyword,
              },
            },
          },
        },
        {
          product: {
            is: {
              baseCode: {
                contains: keyword,
              },
            },
          },
        },
      ];
    }

    return this.prisma.$transaction(
      async (tx) => {
        const total =
          await tx.productVariant.count({
            where,
          });

        const variants =
          await tx.productVariant.findMany({
            where,
            skip: offset,
            take: limit,
            orderBy: {
              id: 'asc',
            },
            select: {
              id: true,
              sku: true,
              inventory: {
                select: {
                  quantity: true,
                  sourceQuantity: true,
                  syncStatus: true,
                  lastConfirmedAt: true,
                  version: true,
                },
              },
            },
          });

        if (variants.length === 0) {
          return {
            items: [],
            pagination: {
              page,
              limit,
              total,
            },
          };
        }

        const variantIds = variants.map(
          (variant) => variant.id,
        );

        // Only unresolved and unreleased effects.
        const pendingEffects =
          await tx.pendingInventoryEffect.groupBy({
            by: ['variantId'],
            where: {
              variantId: {
                in: variantIds,
              },
              status: {
                in: [
                  SyncState.PENDING,
                  SyncState.NEEDS_RECONCILIATION,
                ],
              },
              releasedAt: null,
            },
            _sum: {
              delta: true,
            },
          });

        const pendingDeltaByVariant = new Map(
          pendingEffects.map((effect) => [
            effect.variantId,
            effect._sum.delta ?? 0,
          ]),
        );

        const items: AdminInventoryItem[] =
          variants.map((variant) => {
            const inventory = variant.inventory;

            const pendingDelta =
              pendingDeltaByVariant.get(
                variant.id,
              ) ?? 0;

            const sourceQuantity =
              inventory?.sourceQuantity ?? null;

            if (
              sourceQuantity !== null &&
              sourceQuantity < 0
            ) {
              throw new InternalServerErrorException(
                apiErrorPayload(
                  ErrorCode.INTERNAL_SERVER_ERROR,
                  'Dữ liệu tồn nguồn không hợp lệ.',
                ),
              );
            }

            if (!Number.isSafeInteger(pendingDelta)) {
              throw new InternalServerErrorException(
                apiErrorPayload(
                  ErrorCode.INTERNAL_SERVER_ERROR,
                  'Tổng tác động chờ vượt phạm vi hỗ trợ.',
                ),
              );
            }

            return {
              variantId: String(variant.id),
              sku: variant.sku,

              // Already includes pending effects.
              availableQuantity: Math.max(
                0,
                inventory?.quantity ?? 0,
              ),

              sourceQuantity,

              pendingDelta,

              syncStatus:
                inventory?.syncStatus ??
                SyncState.PENDING,

              lastConfirmedAt:
                inventory?.lastConfirmedAt
                  ?.toISOString() ?? null,

              // Default initial version for an
              // uninitialized inventory.
              version: inventory?.version ?? 1,
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
