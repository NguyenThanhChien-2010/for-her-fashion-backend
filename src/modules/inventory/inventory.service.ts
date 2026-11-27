import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ProductStatus,
  SyncState,
} from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import { PrismaService } from '../prisma/prisma.service';

export interface PublicAvailabilityResponse {
  variantId: string;
  sku: string;
  availableQuantity: number;
  syncStatus: SyncState;
  lastConfirmedAt: string | null;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private parseVariantId(value: string): number {
    if (
      typeof value !== 'string' ||
      !/^[1-9][0-9]*$/.test(value)
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'variantId phải là số nguyên dương.',
        ),
      );
    }

    const id = Number(value);

    if (
      !Number.isSafeInteger(id) ||
      id > 2147483647
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'variantId vượt phạm vi hỗ trợ.',
        ),
      );
    }

    return id;
  }

  /**
   * Read-only public availability.
   *
   * Inventory.quantity already represents sellable
   * stock after pending inventory effects.
   *
   * Do not reserve, deduct, create or update inventory
   * when reading availability.
   */
  async getPublicAvailability(
    variantIdValue: string,
  ): Promise<PublicAvailabilityResponse> {
    const variantId = this.parseVariantId(
      variantIdValue,
    );

    const variant =
      await this.prisma.productVariant.findFirst({
        where: {
          id: variantId,
          isActive: true,
          product: {
            is: {
              status: ProductStatus.ACTIVE,
            },
          },
        },
        select: {
          id: true,
          sku: true,
          inventory: {
            select: {
              quantity: true,
              syncStatus: true,
              lastConfirmedAt: true,
            },
          },
        },
      });

    if (!variant) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Biến thể không tồn tại hoặc không được bán.',
        ),
      );
    }

    const inventory = variant.inventory;

    return {
      variantId: String(variant.id),
      sku: variant.sku,
      availableQuantity: Math.max(
        0,
        inventory?.quantity ?? 0,
      ),
      syncStatus:
        inventory?.syncStatus ?? SyncState.PENDING,
      lastConfirmedAt:
        inventory?.lastConfirmedAt?.toISOString() ?? null,
    };
  }
}
