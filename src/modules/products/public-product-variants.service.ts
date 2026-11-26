import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicProductVariantsQuery {
  colorId?: string;
  sizeCode?: string;
  page?: string;
  limit?: string;
}

@Injectable()
export class PublicProductVariantsService {
  constructor(private readonly prisma: PrismaService) {}

  private badRequest(message: string): BadRequestException {
    return new BadRequestException(
      apiErrorPayload(ErrorCode.VALIDATION_ERROR, message),
    );
  }

  private parsePositiveInteger(
    value: string,
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

    const result = Number(value);

    if (!Number.isSafeInteger(result)) {
      throw this.badRequest(
        `${field} vượt phạm vi hỗ trợ.`,
      );
    }

    return result;
  }

  async findAll(
    productIdValue: string,
    query: PublicProductVariantsQuery,
  ) {
    const productId = this.parsePositiveInteger(
      productIdValue,
      'productId',
    );

    const page =
      query.page === undefined
        ? 1
        : this.parsePositiveInteger(query.page, 'page');

    const limit =
      query.limit === undefined
        ? 20
        : this.parsePositiveInteger(query.limit, 'limit');

    if (limit > 100) {
      throw this.badRequest(
        'limit không được vượt quá 100.',
      );
    }

    const colorId =
      query.colorId === undefined
        ? undefined
        : this.parsePositiveInteger(
            query.colorId,
            'colorId',
          );

    const sizeCode = query.sizeCode;

    if (
      sizeCode !== undefined &&
      (
        typeof sizeCode !== 'string' ||
        sizeCode.length === 0 ||
        sizeCode.length > 10
      )
    ) {
      throw this.badRequest(
        'sizeCode không hợp lệ.',
      );
    }

    const offset = (page - 1) * limit;

    if (!Number.isSafeInteger(offset)) {
      throw this.badRequest(
        'Phân trang vượt phạm vi hỗ trợ.',
      );
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: ProductStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Sản phẩm không tồn tại hoặc không được hiển thị.',
        ),
      );
    }

    const where = {
      productId,
      isActive: true,
      ...(colorId !== undefined ? { colorId } : {}),
      ...(sizeCode !== undefined ? { sizeCode } : {}),
    };

    const [total, variants] = await Promise.all([
      this.prisma.productVariant.count({ where }),
      this.prisma.productVariant.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: {
          id: 'asc' as const,
        },
        select: {
          id: true,
          productId: true,
          colorId: true,
          sizeCode: true,
          sku: true,
          isActive: true,
          version: true,
        },
      }),
    ]);

    return {
      items: variants.map((variant) => ({
        id: String(variant.id),
        productId: String(variant.productId),
        colorId: String(variant.colorId),
        sizeCode: variant.sizeCode,
        sku: variant.sku,
        status: variant.isActive ? 'ACTIVE' : 'INACTIVE',
        version: variant.version,
      })),
      pagination: {
        page,
        limit,
        total,
      },
    };
  }
}