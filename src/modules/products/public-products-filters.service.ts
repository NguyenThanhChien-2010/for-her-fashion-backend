
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  Prisma,
  ProductStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

@Injectable()
export class PublicProductsFiltersService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private parseCategoryId(
    value: unknown,
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !/^[1-9][0-9]*$/.test(value)
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'categoryId phải là số nguyên dương.',
        ),
      );
    }

    const categoryId = Number(value);

    if (!Number.isSafeInteger(categoryId)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'categoryId vượt quá phạm vi hỗ trợ.',
        ),
      );
    }

    return categoryId;
  }

  async getFilters(
    rawCategoryId?: unknown,
  ) {
    const categoryId =
      this.parseCategoryId(rawCategoryId);

    const productWhere: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,

      ...(categoryId !== undefined
        ? { categoryId }
        : {}),
    };

    // Chỉ lấy màu/size đang được sử dụng bởi
    // biến thể ACTIVE của sản phẩm ACTIVE.
    const variantWhere:
      Prisma.ProductVariantWhereInput = {
        isActive: true,
        product: {
          is: productWhere,
        },
      };

    const [colors, sizes, prices] =
      await Promise.all([
        this.prisma.color.findMany({
          where: {
            variants: {
              some: variantWhere,
            },
          },
          select: {
            id: true,
            name: true,
            skuSuffix: true,
            groupId: true,
          },
          orderBy: [
            { name: Prisma.SortOrder.asc },
            { id: Prisma.SortOrder.asc },
          ],
        }),

        this.prisma.size.findMany({
          where: {
            isActive: true,
            variants: {
              some: variantWhere,
            },
          },
          select: {
            code: true,
            name: true,
            skuSuffix: true,
            sortOrder: true,
          },
          orderBy: [
            { sortOrder: Prisma.SortOrder.asc },
            { code: Prisma.SortOrder.asc },
          ],
        }),

        // Giữ cùng cơ sở tính giá với GET /products:
        // giá Product, không phải giá riêng từng SKU.
        this.prisma.product.aggregate({
          where: productWhere,
          _min: {
            price: true,
          },
          _max: {
            price: true,
          },
        }),
      ]);

    const result: {
      colors: Array<{
        id: string;
        name: string;
        skuSuffix: string;
        groupId: string;
      }>;
      sizes: Array<{
        code: string;
        label: string;
        skuSuffix: string;
      }>;
      minPrice?: number;
      maxPrice?: number;
    } = {
      colors: colors.map((color) => ({
        id: String(color.id),
        name: color.name,
        skuSuffix: color.skuSuffix,
        groupId: String(color.groupId),
      })),

      sizes: sizes.map((size) => ({
        code: size.code,
        label: size.name,
        skuSuffix: size.skuSuffix,
      })),
    };

    if (prices._min.price !== null) {
      result.minPrice = Number(prices._min.price);
    }

    if (prices._max.price !== null) {
      result.maxPrice = Number(prices._max.price);
    }

    return result;
  }
}
