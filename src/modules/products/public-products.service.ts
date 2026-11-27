
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

    if (!Number.isSafeInteger(id) || id > 2147483647) {
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

  // Prisma Int IDs use the signed 32-bit range; pagination is separate.
  private parsePositiveId(value: unknown, field: string): number {
    const id = this.parsePositiveInteger(value, field);
    if (id > 2147483647) {
      throw this.badRequest(
        `${field} vượt quá phạm vi hỗ trợ.`,
      );
    }
    return id;
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
  ): 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC' | 'RELEVANCE' {
    if (value === undefined) {
      return 'NEWEST';
    }

    if (
      value === 'NEWEST' ||
      value === 'PRICE_ASC' ||
      value === 'PRICE_DESC' ||
      value === 'RELEVANCE'
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
      this.parsePositiveId(
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

  private async findRelevancePage(params: {
    keyword?: string;
    categoryId?: number;
    minPrice?: number;
    maxPrice?: number;
    colorIds?: number[];
    sizeCodes?: string[];
    inStock?: boolean;
    skip: number;
    limit: number;
  }) {
    const {
      keyword,
      categoryId,
      minPrice,
      maxPrice,
      colorIds,
      sizeCodes,
      inStock,
      skip,
      limit,
    } = params;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.status = 'ACTIVE'`,
    ];

    let allWords: Prisma.Sql | undefined;

    if (keyword !== undefined) {
      const words = [
        ...new Set(
          keyword.trim().split(/\s+/).filter(Boolean),
        ),
      ];

      allWords = Prisma.sql`(
        ${Prisma.join(
          words.map(
            (word) =>
              Prisma.sql`LOCATE(${word}, p.name) > 0`,
          ),
          ' AND ',
        )}
      )`;

      conditions.push(Prisma.sql`(
        LOCATE(${keyword}, p.name) > 0
        OR LOCATE(${keyword}, p.slug) > 0
        OR LOCATE(${keyword}, p.baseCode) > 0
        OR ${allWords}
      )`);
    }

    if (categoryId !== undefined) {
      conditions.push(
        Prisma.sql`p.categoryId = ${categoryId}`,
      );
    }

    if (minPrice !== undefined) {
      conditions.push(
        Prisma.sql`p.price >= ${minPrice}`,
      );
    }

    if (maxPrice !== undefined) {
      conditions.push(
        Prisma.sql`p.price <= ${maxPrice}`,
      );
    }

    // Loc mau, size va ton kho tren CUNG variant
    if (
      colorIds !== undefined ||
      sizeCodes !== undefined ||
      inStock === true
    ) {
      const variantConditions: Prisma.Sql[] = [
        Prisma.sql`v.productId = p.id`,
        Prisma.sql`v.isActive = 1`,
      ];

      if (colorIds !== undefined) {
        variantConditions.push(
          Prisma.sql`v.colorId IN (${Prisma.join(colorIds)})`,
        );
      }

      if (sizeCodes !== undefined) {
        variantConditions.push(
          Prisma.sql`v.sizeCode IN (${Prisma.join(sizeCodes)})`,
        );
      }

      if (inStock === true) {
        variantConditions.push(
          Prisma.sql`i.quantity > 0`,
        );
      }

      conditions.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM product_variants v
          LEFT JOIN inventories i
            ON i.variantId = v.id
          WHERE ${Prisma.join(variantConditions, ' AND ')}
        )
      `);
    }

    // Uu tien tinh trang con hang tren cac SKU
    // phu hop bo loc mau va size hien tai.
    const stockConditions: Prisma.Sql[] = [
      Prisma.sql`sv.productId = p.id`,
      Prisma.sql`sv.isActive = 1`,
      Prisma.sql`si.quantity > 0`,
    ];

    if (colorIds !== undefined) {
      stockConditions.push(
        Prisma.sql`sv.colorId IN (${Prisma.join(colorIds)})`,
      );
    }

    if (sizeCodes !== undefined) {
      stockConditions.push(
        Prisma.sql`sv.sizeCode IN (${Prisma.join(sizeCodes)})`,
      );
    }

    const rank = keyword !== undefined && allWords
      ? Prisma.sql`
          CASE
            WHEN LOCATE(${keyword}, p.name) > 0 THEN 0
            WHEN ${allWords} THEN 1
            ELSE 2
          END
        `
      : Prisma.sql`CASE WHEN p.id IS NOT NULL THEN 0 ELSE 1 END`;

    const whereSql = Prisma.join(conditions, ' AND ');

    // Dem tren toan bo ket qua da loc
    const countQuery = Prisma.sql`
      SELECT COUNT(*) AS total
      FROM products p
      WHERE ${whereSql}
    `;

    // Sap xep truoc, sau do moi LIMIT/OFFSET
    const idsQuery = Prisma.sql`
      SELECT p.id
      FROM products p
      WHERE ${whereSql}
      ORDER BY
        ${rank} ASC,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM product_variants sv
            JOIN inventories si
              ON si.variantId = sv.id
            WHERE ${Prisma.join(stockConditions, ' AND ')}
          ) THEN 0
          ELSE 1
        END ASC,
        p.createdAt DESC,
        p.id ASC
      LIMIT ${limit}
      OFFSET ${skip}
    `;

    const [countRows, idRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ total: bigint | number }>
      >(countQuery),
      this.prisma.$queryRaw<
        Array<{ id: number }>
      >(idsQuery),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const ids = idRows.map((row) => row.id);

    const products = ids.length > 0
      ? await this.prisma.product.findMany({
          where: {
            id: { in: ids },
          },
          include: {
            images: {
              orderBy: [
                { sortOrder: Prisma.SortOrder.asc },
                { id: Prisma.SortOrder.asc },
              ],
            },
          },
        })
      : [];

    const byId = new Map(
      products.map((product) => [product.id, product]),
    );

    const items = ids.flatMap((id) => {
      const product = byId.get(id);
      return product ? [this.toResponse(product)] : [];
    });

    return {
      items,
      pagination: {
        page: skip / limit + 1,
        limit,
        total,
      },
    };
  }
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
      categoryId = this.parsePositiveId(
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

    if (sort === 'RELEVANCE') {
      return this.findRelevancePage({
        keyword,
        categoryId,
        minPrice,
        maxPrice,
        colorIds,
        sizeCodes,
        inStock,
        skip,
        limit,
      });
    }
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
