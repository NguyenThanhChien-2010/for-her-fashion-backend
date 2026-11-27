import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { PinoLogger } from 'nestjs-pino';

import {
  CanActivate,
  ExecutionContext,
  Global,
  HttpStatus,
  Injectable,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';

import {
  APP_GUARD,
  APP_INTERCEPTOR,
  Reflector,
} from '@nestjs/core';

import { Test } from '@nestjs/testing';

import {
  Prisma,
  ProductStatus,
} from '@prisma/client';

import request from 'supertest';
import type { App } from 'supertest/types';

import { ProductsModule } from '../src/modules/products/products.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { IdempotencyService } from '../src/common/services/idempotency.service';

import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// ==========================================
// TEST DATA
// ==========================================

interface TestImage {
  id: number;
  productId: number;
  fileId: number;
  sortOrder: number;
}

interface TestProduct {
  id: number;
  name: string;
  slug: string;
  baseCode: string;
  categoryId: number;
  price: Prisma.Decimal;
  description: string | null;
  status: ProductStatus;
  version: number;
  images: TestImage[];
}

function makeProduct(
  overrides: Partial<TestProduct> = {},
): TestProduct {
  return {
    id: 3,
    name: 'Áo thun nữ kiểm thử Public BE02',
    slug: 'ao-thun-nu-public-be02',
    baseCode: 'ATN-PUBLIC-BE02',
    categoryId: 4,
    price: new Prisma.Decimal(250000),
    description: 'Sản phẩm dùng để kiểm thử API Public Products',
    status: ProductStatus.ACTIVE,
    version: 1,
    images: [],
    ...overrides,
  };
}

const rows = new Map<number, TestProduct>();

// ==========================================
// PRISMA MOCK
// ==========================================

const prismaMock = {
  $queryRaw: jest.fn(),
  color: {
    findMany: jest.fn(),
  },
  size: {
    findMany: jest.fn(),
  },
  product: {
    aggregate: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),

    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: {
          id: number;
          status: ProductStatus;
        };
      }) => {
        const product = rows.get(where.id);

        if (!product) {
          return null;
        }

        if (product.status !== where.status) {
          return null;
        }

        return {
          ...product,
          images: [...product.images].sort(
            (a, b) =>
              a.sortOrder - b.sortOrder ||
              a.id - b.id,
          ),
        };
      },
    ),
  },

  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
};

const idempotencyMock = {
  execute: jest.fn(),
};

// ==========================================
// TEST AUTH GUARD
// ==========================================

// Kiểm tra metadata @Public() mà không cần JWT.
// Đây là guard giả lập, không thay thế test JWT thật.
@Injectable()
class TestAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(
        IS_PUBLIC_KEY,
        [
          context.getHandler(),
          context.getClass(),
        ],
      );

    if (isPublic) {
      return true;
    }

    throw new UnauthorizedException();
  }
}

// ==========================================
// TEST MODULE
// ==========================================

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useValue: prismaMock,
    },
    {
      provide: IdempotencyService,
      useValue: idempotencyMock,
    },
  ],
  exports: [
    PrismaService,
    IdempotencyService,
  ],
})
class TestDependenciesModule {}

@Module({
  imports: [
    TestDependenciesModule,
    ProductsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: TestAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformResponseInterceptor,
    },
  ],
})
class PublicProductsE2eModule {}

// ==========================================
// PUBLIC PRODUCTS HTTP E2E
// ==========================================

describe('BE-02 Public Products HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = '/api/v1/products';

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [PublicProductsE2eModule],
    }).compile();

    app = fixture.createNestApplication();

    app.setGlobalPrefix('api/v1');

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );

    app.useGlobalFilters(new AllExceptionsFilter({ error: jest.fn() } as unknown as PinoLogger));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    rows.clear();

    rows.set(3, makeProduct());

    jest.clearAllMocks();

    prismaMock.$queryRaw.mockReset();
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: 1n }])
      .mockResolvedValueOnce([{ id: 3 }]);

    prismaMock.product.count.mockResolvedValue(1);

    prismaMock.product.findMany.mockResolvedValue([
      makeProduct(),
    ]);

    prismaMock.color.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'BE02 TEST Đỏ',
        skuSuffix: 'B02RED',
        groupId: 1,
      },
      {
        id: 2,
        name: 'BE02 TEST Xanh',
        skuSuffix: 'B02BLUE',
        groupId: 1,
      },
    ]);

    prismaMock.size.findMany.mockResolvedValue([
      {
        code: 'M',
        name: 'Medium',
        skuSuffix: 'BE02M',
        sortOrder: 2,
      },
      {
        code: 'L',
        name: 'Large',
        skuSuffix: 'BE02L',
        sortOrder: 3,
      },
    ]);

    prismaMock.product.aggregate.mockResolvedValue({
      _min: {
        price: new Prisma.Decimal(250000),
      },
      _max: {
        price: new Prisma.Decimal(250000),
      },
    });
  });

  // ==========================================
  // PART 1 - PRODUCT DETAIL
  // ==========================================

  it('DETAIL: không có token vẫn xem được ACTIVE - 200', async () => {
    const response = await request(app.getHttpServer())
      .get(`${endpoint}/3`)
      .expect(HttpStatus.OK);

    expect(response.body.data).toMatchObject({
      id: '3',
      name: 'Áo thun nữ kiểm thử Public BE02',
      slug: 'ao-thun-nu-public-be02',
      baseCode: 'ATN-PUBLIC-BE02',
      categoryId: '4',
      price: 250000,
      status: ProductStatus.ACTIVE,
      version: 1,
      imageFileIds: [],
    });

    expect(response.body.traceId).toEqual(
      expect.any(String),
    );

    expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 3,
          status: ProductStatus.ACTIVE,
        },
      }),
    );
  });

  it('DETAIL: sản phẩm HIDDEN trả 404', async () => {
    rows.set(
      3,
      makeProduct({
        status: ProductStatus.HIDDEN,
      }),
    );

    await request(app.getHttpServer())
      .get(`${endpoint}/3`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('DETAIL: sản phẩm DISCONTINUED trả 404', async () => {
    rows.set(
      3,
      makeProduct({
        status: ProductStatus.DISCONTINUED,
      }),
    );

    await request(app.getHttpServer())
      .get(`${endpoint}/3`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('DETAIL: sản phẩm DRAFT trả 404', async () => {
    rows.set(
      3,
      makeProduct({
        status: ProductStatus.DRAFT,
      }),
    );

    await request(app.getHttpServer())
      .get(`${endpoint}/3`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('DETAIL: sản phẩm không tồn tại trả 404', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/999999`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('DETAIL: ID sai định dạng trả 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/abc`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('DETAIL: ID vượt số nguyên an toàn trả 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/9999999999999999999999`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('DETAIL: ảnh được sắp theo sortOrder', async () => {
    rows.set(
      3,
      makeProduct({
        images: [
          {
            id: 11,
            productId: 3,
            fileId: 101,
            sortOrder: 2,
          },
          {
            id: 12,
            productId: 3,
            fileId: 102,
            sortOrder: 1,
          },
        ],
      }),
    );

    const response = await request(app.getHttpServer())
      .get(`${endpoint}/3`)
      .expect(HttpStatus.OK);

    expect(
      response.body.data.imageFileIds,
    ).toEqual(['102', '101']);
  });

  // ==========================================
  // PART 2 - PRODUCT LIST CƠ BẢN
  // ==========================================

  it('LIST: công khai, trả danh sách ACTIVE - 200', async () => {
    const response = await request(app.getHttpServer())
      .get(endpoint)
      .expect(HttpStatus.OK);

    expect(response.body.data.items).toHaveLength(1);

    expect(response.body.data.items[0]).toMatchObject({
      id: '3',
      name: 'Áo thun nữ kiểm thử Public BE02',
      categoryId: '4',
      price: 250000,
      status: ProductStatus.ACTIVE,
    });

    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
    });

    expect(response.body.traceId).toEqual(
      expect.any(String),
    );

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
      },
    });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ProductStatus.ACTIVE,
        },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('LIST: phân trang page=2 limit=5', async () => {
    const response = await request(app.getHttpServer())
      .get(`${endpoint}?page=2&limit=5`)
      .expect(HttpStatus.OK);

    expect(response.body.data.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 1,
    });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
      }),
    );
  });

  it('LIST: lọc theo categoryId', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?categoryId=4`)
      .expect(HttpStatus.OK);

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        categoryId: 4,
      },
    });
  });

  it('LIST: tìm kiếm theo từ khóa', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?q=thun`)
      .expect(HttpStatus.OK);

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ProductStatus.ACTIVE,
          OR: [
            { name: { contains: 'thun' } },
            { slug: { contains: 'thun' } },
            { baseCode: { contains: 'thun' } },
          ],
        }),
      }),
    );
  });

  it('LIST: lọc giá và sort PRICE_ASC', async () => {
    await request(app.getHttpServer())
      .get(
        `${endpoint}?minPrice=100000&maxPrice=300000&sort=PRICE_ASC`,
      )
      .expect(HttpStatus.OK);

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ProductStatus.ACTIVE,
          price: {
            gte: new Prisma.Decimal(100000),
            lte: new Prisma.Decimal(300000),
          },
        },
        orderBy: [
          { price: Prisma.SortOrder.asc },
          { id: Prisma.SortOrder.desc },
        ],
      }),
    );
  });

  it('LIST: limit=101 trả 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?limit=101`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.findMany,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.product.count,
    ).not.toHaveBeenCalled();
  });

  it('LIST: minPrice lớn hơn maxPrice trả 400', async () => {
    await request(app.getHttpServer())
      .get(
        `${endpoint}?minPrice=500000&maxPrice=100000`,
      )
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.count,
    ).not.toHaveBeenCalled();
  });

  it('LIST: inStock=true được hỗ trợ - 200', async () => {
    const response = await request(app.getHttpServer())
      .get(`${endpoint}?inStock=true`)
      .expect(HttpStatus.OK);

    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
    });

    const expectedWhere = {
      status: ProductStatus.ACTIVE,
      variants: {
        some: {
          isActive: true,
          inventory: {
            is: {
              quantity: { gt: 0 },
            },
          },
        },
      },
    };

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
      }),
    );
  });

  // ==========================================
  // RELEVANCE - FR-03.4
  // ==========================================

  it('RELEVANCE: public request without keyword - 200', async () => {
    const response = await request(app.getHttpServer())
      .get(`${endpoint}?sort=RELEVANCE`)
      .expect(HttpStatus.OK);

    expect(response.body.data.items).toHaveLength(1);

    expect(response.body.data.items[0]).toMatchObject({
      id: '3',
      status: ProductStatus.ACTIVE,
      price: 250000,
    });

    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
    });

    expect(response.body.traceId).toEqual(expect.any(String));

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prismaMock.product.count).not.toHaveBeenCalled();

    const sql = prismaMock.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(sql.sql).toContain(
      'CASE WHEN p.id IS NOT NULL THEN 0 ELSE 1 END',
    );

    expect(sql.sql).toContain('si.quantity > 0');
    expect(sql.sql).toContain('p.createdAt DESC');
    expect(sql.sql).toContain('p.id ASC');
  });

  it('RELEVANCE: keyword uses parameterized SQL - 200', async () => {
    const keyword = 'ao so';

    const response = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        sort: 'RELEVANCE',
        q: keyword,
      })
      .expect(HttpStatus.OK);

    expect(response.body.data.items).toHaveLength(1);

    const countSql = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const idsSql = prismaMock.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(countSql.sql).toContain('LOCATE');
    expect(idsSql.sql).toContain('CASE');
    expect(idsSql.sql).toContain('ELSE 2');

    expect(idsSql.values).toContain(keyword);
    expect(idsSql.values).toContain('ao');
    expect(idsSql.values).toContain('so');

    expect(idsSql.sql).not.toContain(keyword);
  });

  it('RELEVANCE: color size and stock filters use same SKU - 200', async () => {
    await request(app.getHttpServer())
      .get(endpoint)
      .query({
        sort: 'RELEVANCE',
        colorIds: '1',
        sizeCodes: 'M',
        inStock: 'true',
      })
      .expect(HttpStatus.OK);

    const countSql = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const idsSql = prismaMock.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(countSql.sql).toContain('product_variants v');
    expect(countSql.sql).toContain('v.isActive = 1');
    expect(countSql.sql).toContain('v.colorId IN');
    expect(countSql.sql).toContain('v.sizeCode IN');
    expect(countSql.sql).toContain('i.quantity > 0');

    expect(countSql.values).toContain(1);
    expect(countSql.values).toContain('M');

    expect(idsSql.sql).toContain('sv.colorId IN');
    expect(idsSql.sql).toContain('sv.sizeCode IN');
    expect(idsSql.sql).toContain('si.quantity > 0');
  });

  it('RELEVANCE: pagination preserves ranked ID order - 200', async () => {
    prismaMock.$queryRaw.mockReset();

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: 4n }])
      .mockResolvedValueOnce([{ id: 4 }, { id: 3 }]);

    prismaMock.product.findMany.mockResolvedValueOnce([
      makeProduct({ id: 3 }),
      makeProduct({ id: 4, name: 'Product 4' }),
    ]);

    const response = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        sort: 'RELEVANCE',
        page: '2',
        limit: '2',
      })
      .expect(HttpStatus.OK);

    expect(response.body.data.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 4,
    });

    expect(response.body.data.items).toEqual([
      expect.objectContaining({ id: '4' }),
      expect.objectContaining({ id: '3' }),
    ]);

    const idsSql = prismaMock.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(idsSql.sql).toContain('LIMIT');
    expect(idsSql.sql).toContain('OFFSET');
    expect(idsSql.values.slice(-2)).toEqual([2, 2]);
  });

  it('RELEVANCE: empty result returns empty items - 200', async () => {
    prismaMock.$queryRaw.mockReset();

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: 0n }])
      .mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        sort: 'RELEVANCE',
        q: 'NO-MATCH-BE02',
      })
      .expect(HttpStatus.OK);

    expect(response.body.data.items).toEqual([]);

    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
    });

    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
  });

  it('RELEVANCE: invalid price range returns 400', async () => {
    await request(app.getHttpServer())
      .get(endpoint)
      .query({
        sort: 'RELEVANCE',
        minPrice: '500000',
        maxPrice: '100000',
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
  });


  // ==========================================
  // PART 3 - SKU FILTERS
  // ==========================================

  it('SKU: colorIds=1 và sizeCodes=M - 200', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?colorIds=1&sizeCodes=M`)
      .expect(HttpStatus.OK);

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            colorId: { in: [1] },
            sizeCode: { in: ['M'] },
          },
        },
      },
    });
  });

  it('SKU: nhiều màu dùng OR trong nhóm màu', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?colorIds=1&colorIds=2`)
      .expect(HttpStatus.OK);

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            colorId: {
              in: [1, 2],
            },
          },
        },
      },
    });
  });

  it('SKU: nhiều size dùng OR trong nhóm size', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?sizeCodes=M&sizeCodes=L`)
      .expect(HttpStatus.OK);

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            sizeCode: {
              in: ['M', 'L'],
            },
          },
        },
      },
    });
  });

  it('SKU: màu, size, tồn kho cùng một ProductVariant', async () => {
    await request(app.getHttpServer())
      .get(
        `${endpoint}?colorIds=1&sizeCodes=L&inStock=true`,
      )
      .expect(HttpStatus.OK);

    const expectedWhere = {
      status: ProductStatus.ACTIVE,
      variants: {
        some: {
          isActive: true,
          colorId: {
            in: [1],
          },
          sizeCode: {
            in: ['L'],
          },
          inventory: {
            is: {
              quantity: {
                gt: 0,
              },
            },
          },
        },
      },
    };

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
      }),
    );
  });

  it('SKU: colorIds không hợp lệ trả 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?colorIds=abc`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.findMany,
    ).not.toHaveBeenCalled();
  });

  it('SKU: inStock không hợp lệ trả 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}?inStock=invalid`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.count,
    ).not.toHaveBeenCalled();
  });

  // ==========================================
  // PART 4 - PUBLIC PRODUCT FILTERS
  // ==========================================

  it('FILTERS: không cần token vẫn trả HTTP 200', async () => {
    const response = await request(app.getHttpServer())
      .get(`${endpoint}/filters`)
      .expect(HttpStatus.OK);

    expect(response.body.data).toEqual({
      colors: [
        {
          id: '1',
          name: 'BE02 TEST Đỏ',
          skuSuffix: 'B02RED',
          groupId: '1',
        },
        {
          id: '2',
          name: 'BE02 TEST Xanh',
          skuSuffix: 'B02BLUE',
          groupId: '1',
        },
      ],
      sizes: [
        {
          code: 'M',
          label: 'Medium',
          skuSuffix: 'BE02M',
        },
        {
          code: 'L',
          label: 'Large',
          skuSuffix: 'BE02L',
        },
      ],
      minPrice: 250000,
      maxPrice: 250000,
    });

    expect(response.body.traceId).toEqual(expect.any(String));
  });

  it('FILTERS: route filters không bị hiểu là productId', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/filters`)
      .expect(HttpStatus.OK);

    expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.color.findMany).toHaveBeenCalledTimes(1);
  });

  it('FILTERS: categoryId=4 giới hạn đúng danh mục', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/filters?categoryId=4`)
      .expect(HttpStatus.OK);

    expect(prismaMock.product.aggregate).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        categoryId: 4,
      },
      _min: { price: true },
      _max: { price: true },
    });

    expect(prismaMock.color.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          variants: {
            some: {
              isActive: true,
              product: {
                is: {
                  status: ProductStatus.ACTIVE,
                  categoryId: 4,
                },
              },
            },
          },
        },
      }),
    );
  });

  it('FILTERS: categoryId sai trả HTTP 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/filters?categoryId=abc`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.product.aggregate).not.toHaveBeenCalled();
  });

  it('FILTERS: query không hỗ trợ trả HTTP 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/filters?unknown=test`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.color.findMany).not.toHaveBeenCalled();
  });

  it('FILTERS: danh mục không có dữ liệu trả các mảng rỗng', async () => {
    prismaMock.color.findMany.mockResolvedValue([]);
    prismaMock.size.findMany.mockResolvedValue([]);
    prismaMock.product.aggregate.mockResolvedValue({
      _min: { price: null },
      _max: { price: null },
    });

    const response = await request(app.getHttpServer())
      .get(`${endpoint}/filters?categoryId=999999`)
      .expect(HttpStatus.OK);

    expect(response.body.data).toEqual({
      colors: [],
      sizes: [],
    });
  });
});
