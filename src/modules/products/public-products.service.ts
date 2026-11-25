
import {
  BadRequestException,
  Injectable,
  NotFoundException,
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

export interface PublicProductsQuery {
  [key: string]: unknown;

  page?: string;
  limit?: string;
  q?: string;
  categoryId?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;

  colorIds?: string | string[];
  sizeCodes?: string | string[];
  inStock?: string;
}

@Injectable()
export class PublicProductsService {
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

  private parseProductId(
    value: string,
  ): number {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw this.badRequest(
        'ID sản phẩm không hợp lệ.',
      );
    }

    const id = Number(value);

    if (!Number.isSafeInteger(id)) {
      throw this.badRequest(
        'ID sản phẩm vượt quá phạm vi hỗ trợ.',
      );
    }

    return id;
  }

  private parsePositiveInteger(
    value: unknown,
    field: string,
    defaultValue?: number,
  ): number {
    if (value === undefined) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }

      throw this.badRequest(
        `${field} là bắt buộc.`,
      );
    }

    if (
      typeof value !== 'string' ||
      !/^[1-9][0-9]*$/.test(value)
    ) {
      throw this.badRequest(
        `${field} phải là số nguyên dương.`,
      );
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed)) {
      throw this.badRequest(
        `${field} vượt quá phạm vi hỗ trợ.`,
      );
    }

    return parsed;
  }

  private parsePrice(
    value: unknown,
    field: string,
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(value)
    ) {
      throw this.badRequest(
        `${field} phải là số nguyên không âm.`,
      );
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed)) {
      throw this.badRequest(
        `${field} vượt quá phạm vi hỗ trợ.`,
      );
    }

    return parsed;
  }

  private parseSort(
    value: unknown,
  ): 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC' {
    if (value === undefined) {
      return 'NEWEST';
    }

    if (
      value === 'NEWEST' ||
      value === 'PRICE_ASC' ||
      value === 'PRICE_DESC'
    ) {
      return value;
    }

    throw this.badRequest(
      'sort không hợp lệ hoặc chưa được hỗ trợ.',
    );
  }

  // Swagger/OpenAPI truyền nhiều giá trị bằng:
  // ?colorIds=1&colorIds=2
  private parseArray(
    value: unknown,
    field: string,
  ): string[] | undefined {
    if (value === undefined) {
      return undefined;
    }

    const values = Array.isArray(value)
      ? value
      : [value];

    if (
      values.length === 0 ||
      values.length > 50 ||
      values.some(
        (item) =>
          typeof item !== 'string' ||
          item.trim().length === 0,
      )
    ) {
      throw this.badRequest(
        `${field} phải chứa từ 1 đến 50 giá trị hợp lệ.`,
      );
    }

    return [
      ...new Set(
        values.map((item: string) =>
          item.trim(),
        ),
      ),
    ];
  }

  private parseColorIds(
    value: unknown,
  ): number[] | undefined {
    const values = this.parseArray(
      value,
      'colorIds',
    );

    if (!values) {
      return undefined;
    }

    return values.map((item) =>
      this.parsePositiveInteger(
        item,
        'colorIds',
      ),
    );
  }

  private parseSizeCodes(
    value: unknown,
  ): string[] | undefined {
    const values = this.parseArray(
      value,
      'sizeCodes',
    );

    if (!values) {
      return undefined;
    }

    for (const code of values) {
      if (code.length > 10) {
        throw this.badRequest(
          'Mã size không được vượt quá 10 ký tự.',
        );
      }
    }

    return values;
  }

  private parseInStock(
    value: unknown,
  ): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw this.badRequest(
      'inStock phải là true hoặc false.',
    );
  }

  // ==========================================
  // RESPONSE FORMAT
  // ==========================================

  private toResponse(
    product: Prisma.ProductGetPayload<{
      include: { images: true };
    }>,
  ) {
    return {
      id: String(product.id),
      name: product.name,
      slug: product.slug,
      baseCode: product.baseCode,
      categoryId: String(product.categoryId),
      price: Number(product.price),

      ...(product.description !== null
        ? {
            description: product.description,
          }
        : {}),

      status: product.status,

      imageFileIds: product.images.map(
        (image) => String(image.fileId),
      ),

      version: product.version,
    };
  }

  // ==========================================
  // GET /api/v1/products
  // ==========================================

  async findAll(
    query: PublicProductsQuery = {},
  ) {
    const allowedFields = new Set([
      'page',
      'limit',
      'q',
      'categoryId',
      'minPrice',
      'maxPrice',
      'sort',
      'colorIds',
      'sizeCodes',
      'inStock',
    ]);

    for (const key of Object.keys(query)) {
      if (!allowedFields.has(key)) {
        throw this.badRequest(
          `Tham số ${key} chưa được hỗ trợ.`,
        );
      }
    }

    const page = this.parsePositiveInteger(
      query.page,
      'page',
      1,
    );

    const limit = this.parsePositiveInteger(
      query.limit,
      'limit',
      20,
    );

    if (limit > 100) {
      throw this.badRequest(
        'limit không được lớn hơn 100.',
      );
    }

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      throw this.badRequest(
        'page vượt quá phạm vi hỗ trợ.',
      );
    }

    let categoryId: number | undefined;

    if (query.categoryId !== undefined) {
      categoryId = this.parsePositiveInteger(
        query.categoryId,
        'categoryId',
      );
    }

    const minPrice = this.parsePrice(
      query.minPrice,
      'minPrice',
    );

    const maxPrice = this.parsePrice(
      query.maxPrice,
      'maxPrice',
    );

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      throw this.badRequest(
        'minPrice không được lớn hơn maxPrice.',
      );
    }

    let keyword: string | undefined;

    if (query.q !== undefined) {
      if (typeof query.q !== 'string') {
        throw this.badRequest(
          'q phải là chuỗi ký tự.',
        );
      }

      const trimmed = query.q.trim();

      if (trimmed.length > 255) {
        throw this.badRequest(
          'q không được vượt quá 255 ký tự.',
        );
      }

      if (trimmed.length > 0) {
        keyword = trimmed;
      }
    }

    const sort = this.parseSort(
      query.sort,
    );

    const colorIds = this.parseColorIds(
      query.colorIds,
    );

    const sizeCodes = this.parseSizeCodes(
      query.sizeCodes,
    );

    const inStock = this.parseInStock(
      query.inStock,
    );

    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
    };

    // ========================================
    // BASIC FILTERS
    // ========================================

    if (categoryId !== undefined) {
      where.categoryId = categoryId;
    }

    if (keyword !== undefined) {
      where.OR = [
        {
          name: {
            contains: keyword,
          },
        },
        {
          slug: {
            contains: keyword,
          },
        },
        {
          baseCode: {
            contains: keyword,
          },
        },
      ];
    }

    if (
      minPrice !== undefined ||
      maxPrice !== undefined
    ) {
      where.price = {
        ...(minPrice !== undefined
          ? {
              gte: new Prisma.Decimal(minPrice),
            }
          : {}),

        ...(maxPrice !== undefined
          ? {
              lte: new Prisma.Decimal(maxPrice),
            }
          : {}),
      };
    }

    // ========================================
    // SKU FILTERS
    // TẤT CẢ điều kiện trên cùng một variant.
    // ========================================

    const hasSkuFilter =
      colorIds !== undefined ||
      sizeCodes !== undefined ||
      inStock === true;

    if (hasSkuFilter) {
      const variantWhere:
        Prisma.ProductVariantWhereInput = {
          isActive: true,
        };

      if (colorIds !== undefined) {
        variantWhere.colorId = {
          in: colorIds,
        };
      }

      if (sizeCodes !== undefined) {
        variantWhere.sizeCode = {
          in: sizeCodes,
        };
      }

      if (inStock === true) {
        variantWhere.inventory = {
          is: {
            quantity: {
              gt: 0,
            },
          },
        };
      }

      // Một ProductVariant duy nhất phải đáp ứng
      // đồng thời màu, size và tồn kho.
      where.variants = {
        some: variantWhere,
      };
    }

    // ========================================
    // SORT
    // ========================================

    let orderBy:
      Prisma.ProductOrderByWithRelationInput[];

    switch (sort) {
      case 'PRICE_ASC':
        orderBy = [
          {
            price: Prisma.SortOrder.asc,
          },
          {
            id: Prisma.SortOrder.desc,
          },
        ];
        break;

      case 'PRICE_DESC':
        orderBy = [
          {
            price: Prisma.SortOrder.desc,
          },
          {
            id: Prisma.SortOrder.desc,
          },
        ];
        break;

      default:
        orderBy = [
          {
            createdAt: Prisma.SortOrder.desc,
          },
          {
            id: Prisma.SortOrder.desc,
          },
        ];
    }

    // ========================================
    // DATABASE QUERY
    // ========================================

    const [total, products] =
      await Promise.all([
        this.prisma.product.count({
          where,
        }),

        this.prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            images: {
              orderBy: [
                {
                  sortOrder: Prisma.SortOrder.asc,
                },
                {
                  id: Prisma.SortOrder.asc,
                },
              ],
            },
          },
        }),
      ]);

    return {
      items: products.map(
        (product) => this.toResponse(product),
      ),

      pagination: {
        page,
        limit,
        total,
      },
    };
  }

  // ==========================================
  // GET /api/v1/products/:productId
  // ==========================================

  async findOne(
    productId: string,
  ) {
    const id = this.parseProductId(
      productId,
    );

    const product =
      await this.prisma.product.findFirst({
        where: {
          id,
          status: ProductStatus.ACTIVE,
        },

        include: {
          images: {
            orderBy: [
              {
                sortOrder: Prisma.SortOrder.asc,
              },
              {
                id: Prisma.SortOrder.asc,
              },
            ],
          },
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

    return this.toResponse(product);
  }
}
