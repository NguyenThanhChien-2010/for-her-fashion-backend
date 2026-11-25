
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
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma, ProductStatus, UserRole } from '@prisma/client';
import type { Request } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';

import { ProductsModule } from '../src/modules/products/products.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// ==========================================
// TEST TYPES
// ==========================================

interface TestProductImage {
  id: number;
  productId: number;
  colorId: number | null;
  fileId: number;
  sortOrder: number;
}

interface TestProduct {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  baseCode: string;
  description: string | null;
  price: Prisma.Decimal;
  status: ProductStatus;
  version: number;
  sizeChartId: number | null;
  createdAt: Date;
  updatedAt: Date;
  images: TestProductImage[];
}

interface ProductReferences {
  variants: number;
  images: number;
  wishlist: number;
  reviews: number;
  ratingStats: boolean;
}

type TestRequest = Request & {
  user?: {
    id: number;
    role: UserRole;
  };
};

// ==========================================
// IN-MEMORY DATABASE
// ==========================================

const rows = new Map<number, TestProduct>();

const references = new Map<number, ProductReferences>();

const replayCache = new Map<
  string,
  {
    statusCode: number;
    data: unknown;
  }
>();

let nextId = 2;

function emptyReferences(): ProductReferences {
  return {
    variants: 0,
    images: 0,
    wishlist: 0,
    reviews: 0,
    ratingStats: false,
  };
}

function productFixture(
  overrides: Partial<TestProduct> = {},
): TestProduct {
  return {
    id: 1,
    categoryId: 4,
    name: 'Áo sơ mi BE02',
    slug: 'ao-so-mi-be02',
    baseCode: 'ASM-BE02-001',
    description: 'Mô tả ban đầu',
    price: new Prisma.Decimal(350000),
    status: ProductStatus.ACTIVE,
    version: 2,
    sizeChartId: null,
    createdAt: new Date('2026-11-25T08:00:00Z'),
    updatedAt: new Date('2026-11-25T08:00:00Z'),
    images: [],
    ...overrides,
  };
}

function cloneProduct(row: TestProduct): TestProduct {
  return {
    ...row,
    images: row.images.map((image) => ({
      ...image,
    })),
  };
}

function productForQuery(row: TestProduct) {
  const related = references.get(row.id) ?? emptyReferences();

  return {
    ...cloneProduct(row),
    _count: {
      variants: related.variants,
      images: Math.max(related.images, row.images.length),
      wishlist: related.wishlist,
      reviews: related.reviews,
    },
    ratingStats: related.ratingStats
      ? { productId: row.id }
      : null,
  };
}

// ==========================================
// PRISMA MOCK
// ==========================================

const db = {
  product: {
    findMany: jest.fn(
      async ({
        skip = 0,
        take = 20,
      }: {
        skip?: number;
        take?: number;
      }) =>
        Array.from(rows.values())
          .sort((a, b) => b.id - a.id)
          .slice(skip, skip + take)
          .map(cloneProduct),
    ),

    count: jest.fn(async () => rows.size),

    findUnique: jest.fn(
      async ({
        where,
      }: {
        where: { id: number };
      }) => {
        const row = rows.get(where.id);

        return row ? productForQuery(row) : null;
      },
    ),

    findUniqueOrThrow: jest.fn(
      async ({
        where,
      }: {
        where: { id: number };
      }) => {
        const row = rows.get(where.id);

        if (!row) {
          throw new Error(
            'Product not found in test database',
          );
        }

        return cloneProduct(row);
      },
    ),

    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: {
          OR: {
            slug?: string;
            baseCode?: string;
          }[];
        };
      }) => {
        const row = Array.from(rows.values()).find(
          (item) =>
            where.OR.some(
              (condition) =>
                (condition.slug !== undefined &&
                  item.slug === condition.slug) ||
                (condition.baseCode !== undefined &&
                  item.baseCode === condition.baseCode),
            ),
        );

        return row ? { id: row.id } : null;
      },
    ),

    create: jest.fn(
      async ({
        data,
      }: {
        data: {
          name: string;
          slug: string;
          baseCode: string;
          categoryId: number;
          price: Prisma.Decimal;
          description: string | null;
          status: ProductStatus;
          images?: {
            create?: {
              fileId: number;
              sortOrder: number;
            }[];
          };
        };
      }) => {
        const id = nextId++;

        const images = (data.images?.create ?? []).map(
          (image, index) => ({
            id: index + 1,
            productId: id,
            colorId: null,
            ...image,
          }),
        );

        const row = productFixture({
          ...data,
          id,
          version: 1,
          images,
        });

        rows.set(id, row);

        return cloneProduct(row);
      },
    ),

    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: {
          id: number;
          version: number;
        };
        data: Record<string, unknown>;
      }) => {
        const current = rows.get(where.id);

        if (
          !current ||
          current.version !== where.version
        ) {
          return { count: 0 };
        }

        for (const [field, value] of Object.entries(data)) {
          if (
            field === 'version' &&
            typeof value === 'object' &&
            value !== null
          ) {
            current.version += (
              value as { increment: number }
            ).increment;
          } else if (
            field !== 'version' &&
            value !== undefined
          ) {
            (
              current as unknown as Record<
                string,
                unknown
              >
            )[field] = value;
          }
        }

        return { count: 1 };
      },
    ),

    // Mock DELETE với điều kiện version.
    deleteMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          id: number;
          version: number;
        };
      }) => {
        const current = rows.get(where.id);

        if (
          !current ||
          current.version !== where.version
        ) {
          return { count: 0 };
        }

        rows.delete(where.id);
        references.delete(where.id);

        return { count: 1 };
      },
    ),
  },

  productVariant: {
    count: jest.fn(async () => 0),
  },

  productImage: {
    deleteMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          productId: number;
        };
      }) => {
        const row = rows.get(where.productId);
        const count = row?.images.length ?? 0;

        if (row) {
          row.images = [];
        }

        return { count };
      },
    ),

    createMany: jest.fn(
      async ({
        data,
      }: {
        data: {
          productId: number;
          fileId: number;
          sortOrder: number;
        }[];
      }) => {
        for (const item of data) {
          rows.get(item.productId)?.images.push({
            id: item.sortOrder + 1,
            colorId: null,
            ...item,
          });
        }

        return { count: data.length };
      },
    ),
  },

  category: {
    findUnique: jest.fn(
      async ({
        where,
      }: {
        where: {
          id: number;
        };
      }) => (where.id === 4 ? { id: 4 } : null),
    ),
  },

  file: {
    count: jest.fn(async () => 0),
  },

  auditLog: {
    create: jest.fn(async () => ({ id: 1n })),
  },
};

type TestDb = typeof db;

const transactionMock = jest.fn(
  async (
    arg:
      | ((client: TestDb) => Promise<unknown>)
      | Promise<unknown>[],
  ): Promise<unknown> =>
    typeof arg === 'function'
      ? arg(db)
      : Promise.all(arg),
);

const prismaStub = {
  ...db,
  $transaction: transactionMock,
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
};

// ==========================================
// IDEMPOTENCY MOCK
// ==========================================

const idempotencyStub = {
  execute: jest.fn(
    async (
      subject: string,
      key: string,
      scope: string,
      callback: (
        client: TestDb,
      ) => Promise<{
        statusCode: number;
        data: unknown;
      }>,
    ): Promise<unknown> => {
      const cacheKey = `${subject}:${scope}:${key}`;

      const cached = replayCache.get(cacheKey);

      if (cached) {
        return cached.data;
      }

      const result = await callback(db);

      replayCache.set(cacheKey, result);

      return result.data;
    },
  ),
};

// ==========================================
// TEST AUTHENTICATION
// ==========================================

@Injectable()
class TestIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<TestRequest>();

    const authorization = req.headers.authorization;

    const token = Array.isArray(authorization)
      ? authorization[0]
      : authorization;

    const identities: Record<
      string,
      { id: number; role: UserRole }
    > = {
      'Bearer test-admin-token': {
        id: 1,
        role: UserRole.ADMIN,
      },
      'Bearer test-staff-token': {
        id: 2,
        role: UserRole.STAFF,
      },
      'Bearer test-customer-token': {
        id: 3,
        role: UserRole.CUSTOMER,
      },
    };

    const identity = token
      ? identities[token]
      : undefined;

    if (!identity) {
      throw new UnauthorizedException();
    }

    req.user = identity;

    return true;
  }
}

// ==========================================
// TESTING MODULE
// ==========================================

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useValue: prismaStub,
    },
    {
      provide: IdempotencyService,
      useValue: idempotencyStub,
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
      useClass: TestIdentityGuard,
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
class ProductsE2eModule {}

// ==========================================
// PRODUCTS HTTP E2E
// ==========================================

describe('BE-02 Products HTTP E2E', () => {
  let app: INestApplication<App>;

  const adminToken = 'Bearer test-admin-token';
  const staffToken = 'Bearer test-staff-token';
  const customerToken = 'Bearer test-customer-token';

  const createBody = {
    name: 'Váy công sở BE02',
    slug: 'vay-cong-so-be02',
    baseCode: 'VCS-BE02-001',
    categoryId: '4',
    price: 420000,
    description: 'Dữ liệu kiểm thử E2E',
    imageFileIds: [],
    status: 'ACTIVE',
  };

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [ProductsE2eModule],
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

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    rows.clear();
    rows.set(1, productFixture());

    references.clear();

    replayCache.clear();

    nextId = 2;

    jest.clearAllMocks();
  });

  // ==========================================
  // GET PRODUCTS
  // ==========================================

  it('GET admin không có token trả 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/products')
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('CUSTOMER không được xem Products admin, trả 403', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/products')
      .set('Authorization', customerToken)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('STAFF được GET danh sách Products admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/products?page=1&limit=20')
      .set('Authorization', staffToken)
      .expect(HttpStatus.OK);

    expect(res.body.data.items).toHaveLength(1);

    expect(res.body.data.pagination.total).toBe(1);
  });

  // ==========================================
  // POST PRODUCTS
  // ==========================================

  it('ADMIN tạo Product, trả 201 và ghi AuditLog', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set('Authorization', adminToken)
      .set(
        'Idempotency-Key',
        'be02-products-e2e-create-0001',
      )
      .send(createBody)
      .expect(HttpStatus.CREATED);

    expect(res.body.data).toMatchObject({
      id: '2',
      slug: createBody.slug,
      version: 1,
    });

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PRODUCT_CREATE',
        actorId: 1,
      }),
    });
  });

  it('STAFF không được tạo Product, trả 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set('Authorization', staffToken)
      .set(
        'Idempotency-Key',
        'be02-products-e2e-create-0002',
      )
      .send(createBody)
      .expect(HttpStatus.FORBIDDEN);

    expect(db.product.create).not.toHaveBeenCalled();
  });

  it('POST có trường không khai báo bị từ chối 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set('Authorization', adminToken)
      .set(
        'Idempotency-Key',
        'be02-products-e2e-create-0003',
      )
      .send({
        ...createBody,
        unknownField: 'not-allowed',
      })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('POST trùng slug trả 409, không tạo sản phẩm mới', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set('Authorization', adminToken)
      .set(
        'Idempotency-Key',
        'be02-products-e2e-create-0004',
      )
      .send({
        ...createBody,
        slug: 'ao-so-mi-be02',
      })
      .expect(HttpStatus.CONFLICT);

    expect(rows.size).toBe(1);
  });

  it('Gửi lại POST cùng key/body không tạo thêm Product', async () => {
    const url = '/api/v1/admin/products';
    const key = 'be02-products-e2e-replay-0001';

    const first = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', key)
      .send(createBody)
      .expect(HttpStatus.CREATED);

    const second = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', key)
      .send(createBody)
      .expect(HttpStatus.CREATED);

    expect(first.body.data.id).toBe(
      second.body.data.id,
    );

    expect(rows.size).toBe(2);

    expect(
      db.product.create,
    ).toHaveBeenCalledTimes(1);
  });

  // ==========================================
  // PATCH PRODUCTS
  // ==========================================

  it('STAFF sửa giá trả 403, không cập nhật DB', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/products/1')
      .set('Authorization', staffToken)
      .send({
        version: 2,
        price: 200000,
      })
      .expect(HttpStatus.FORBIDDEN);

    expect(
      rows.get(1)?.price.toNumber(),
    ).toBe(350000);

    expect(rows.get(1)?.version).toBe(2);
  });

  it('STAFF sửa tên được phép, version tăng và ghi AuditLog', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/admin/products/1')
      .set('Authorization', staffToken)
      .send({
        version: 2,
        name: 'Sản phẩm STAFF sửa',
      })
      .expect(HttpStatus.OK);

    expect(res.body.data).toMatchObject({
      name: 'Sản phẩm STAFF sửa',
      version: 3,
    });

    expect(rows.get(1)?.name).toBe(
      'Sản phẩm STAFF sửa',
    );

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PRODUCT_UPDATE',
        actorId: 2,
      }),
    });
  });

  it('PATCH version cũ trả 409 và không thay đổi sản phẩm', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .send({
        version: 1,
        name: 'Tên không được lưu',
      })
      .expect(HttpStatus.CONFLICT);

    expect(rows.get(1)?.name).toBe(
      'Áo sơ mi BE02',
    );
  });

  it('PATCH chỉ có version trả 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .send({
        version: 2,
      })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('ADMIN cập nhật trạng thái DISCONTINUED', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .send({
        version: 2,
        status: 'DISCONTINUED',
      })
      .expect(HttpStatus.OK);

    expect(res.body.data).toMatchObject({
      status: 'DISCONTINUED',
      version: 3,
    });

    expect(rows.get(1)?.status).toBe(
      ProductStatus.DISCONTINUED,
    );
  });

  // ==========================================
  // DELETE PRODUCTS
  // ==========================================

  it('DELETE không có token trả 401', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('If-Match', '"2"')
      .expect(HttpStatus.UNAUTHORIZED);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE STAFF trả 403 và không xóa dữ liệu', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', staffToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.FORBIDDEN);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE ADMIN thiếu If-Match trả 400', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .expect(HttpStatus.BAD_REQUEST);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE If-Match sai định dạng trả 400', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '2')
      .expect(HttpStatus.BAD_REQUEST);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE sản phẩm không tồn tại trả 404', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/999999')
      .set('Authorization', adminToken)
      .set('If-Match', '"1"')
      .expect(HttpStatus.NOT_FOUND);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE version không khớp trả 409', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"999"')
      .expect(HttpStatus.CONFLICT);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE sản phẩm có SKU trả 409', async () => {
    references.set(1, {
      ...emptyReferences(),
      variants: 1,
    });

    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.CONFLICT);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE sản phẩm có ảnh trả 409', async () => {
    references.set(1, {
      ...emptyReferences(),
      images: 1,
    });

    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.CONFLICT);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE sản phẩm có wishlist trả 409', async () => {
    references.set(1, {
      ...emptyReferences(),
      wishlist: 1,
    });

    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.CONFLICT);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE sản phẩm có đánh giá trả 409', async () => {
    references.set(1, {
      ...emptyReferences(),
      reviews: 1,
    });

    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.CONFLICT);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE sản phẩm có ratingStats trả 409', async () => {
    references.set(1, {
      ...emptyReferences(),
      ratingStats: true,
    });

    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.CONFLICT);

    expect(rows.has(1)).toBe(true);

    expect(
      db.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE thành công trả 204 và ghi AuditLog', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.NO_CONTENT);

    expect(res.text).toBe('');

    expect(rows.has(1)).toBe(false);

    expect(db.product.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 1,
        version: 2,
      },
    });

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1,
        action: 'PRODUCT_DELETE',
        entityType: 'Product',
        entityId: '1',
        after: {
          deleted: true,
        },
      }),
    });

    expect(transactionMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('DELETE version bị thay đổi đồng thời trả 409', async () => {
    // Mô phỏng bản ghi bị thay đổi sau khi đọc.
    db.product.deleteMany.mockResolvedValueOnce({
      count: 0,
    });

    await request(app.getHttpServer())
      .delete('/api/v1/admin/products/1')
      .set('Authorization', adminToken)
      .set('If-Match', '"2"')
      .expect(HttpStatus.CONFLICT);

    expect(rows.has(1)).toBe(true);

    expect(
      db.auditLog.create,
    ).not.toHaveBeenCalled();
  });
});
