
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
} from '@nestjs/core';

import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';

import request from 'supertest';
import type { App } from 'supertest/types';
import type { Request } from 'express';

import { CategoriesModule } from '../src/modules/categories/categories.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// ==========================================
// TEST TYPES
// ==========================================

interface TestCategory {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  sizeChartId: number | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

interface CategoryWriteData {
  name?: string;
  slug?: string;
  parentId?: number | null;
  isActive?: boolean;
  version?: {
    increment: number;
  };
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

const rows = new Map<number, TestCategory>();

const replayCache = new Map<string, unknown>();

let nextId = 10;

function testCategory(
  overrides: Partial<TestCategory> = {},
): TestCategory {
  return {
    id: 2,
    name: 'Váy thời trang nữ',
    slug: 'vay-thoi-trang-nu',
    parentId: null,
    sizeChartId: null,
    sortOrder: 0,
    isActive: true,
    version: 2,
    ...overrides,
  };
}

function findCategory(where: {
  id?: number;
  slug?: string;
}): TestCategory | null {
  const result = Array.from(rows.values()).find(
    (row) =>
      (where.id === undefined || row.id === where.id) &&
      (where.slug === undefined || row.slug === where.slug),
  );

  return result ? { ...result } : null;
}

// ==========================================
// PRISMA MOCK
// Không khai báo $transaction bên trong db.
// Điều này tránh lỗi TS7022, TS7024, TS2502.
// ==========================================

const db = {
  category: {
    findMany: jest.fn(
      async ({
        where,
        skip = 0,
        take = 20,
      }: {
        where?: {
          isActive?: boolean;
        };
        skip?: number;
        take?: number;
      }): Promise<TestCategory[]> => {
        const items = Array.from(rows.values())
          .filter(
            (row) =>
              where?.isActive === undefined ||
              row.isActive === where.isActive,
          )
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder ||
              a.id - b.id,
          );

        return items
          .slice(skip, skip + take)
          .map((row) => ({ ...row }));
      },
    ),

    count: jest.fn(
      async ({
        where,
      }: {
        where?: {
          parentId?: number;
          isActive?: boolean;
        };
      }): Promise<number> => {
        return Array.from(rows.values()).filter(
          (row) =>
            (where?.parentId === undefined ||
              row.parentId === where.parentId) &&
            (where?.isActive === undefined ||
              row.isActive === where.isActive),
        ).length;
      },
    ),

    findUnique: jest.fn(
      async ({
        where,
      }: {
        where: {
          id?: number;
          slug?: string;
        };
      }): Promise<TestCategory | null> => {
        return findCategory(where);
      },
    ),

    findUniqueOrThrow: jest.fn(
      async ({
        where,
      }: {
        where: {
          id?: number;
          slug?: string;
        };
      }): Promise<TestCategory> => {
        const category = findCategory(where);

        if (!category) {
          throw new Error('Category not found');
        }

        return category;
      },
    ),

    create: jest.fn(
      async ({
        data,
      }: {
        data: {
          name: string;
          slug: string;
          parentId: number | null;
          isActive: boolean;
        };
      }): Promise<TestCategory> => {
        const row = testCategory({
          ...data,
          id: nextId++,
          version: 1,
        });

        rows.set(row.id, row);

        return { ...row };
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
        data: CategoryWriteData;
      }): Promise<{ count: number }> => {
        const current = rows.get(where.id);

        if (
          !current ||
          current.version !== where.version
        ) {
          return { count: 0 };
        }

        rows.set(where.id, {
          ...current,

          ...(data.name !== undefined
            ? { name: data.name }
            : {}),

          ...(data.slug !== undefined
            ? { slug: data.slug }
            : {}),

          ...(data.parentId !== undefined
            ? { parentId: data.parentId }
            : {}),

          ...(data.isActive !== undefined
            ? { isActive: data.isActive }
            : {}),

          version:
            current.version +
            (data.version?.increment ?? 0),
        });

        return { count: 1 };
      },
    ),

    deleteMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          id: number;
          version: number;
        };
      }): Promise<{ count: number }> => {
        const current = rows.get(where.id);

        if (
          !current ||
          current.version !== where.version
        ) {
          return { count: 0 };
        }

        rows.delete(where.id);

        return { count: 1 };
      },
    ),
  },

  product: {
    count: jest.fn().mockResolvedValue(0),
  },

  auditLog: {
    create: jest.fn().mockResolvedValue({
      id: 100,
    }),
  },
};

// ==========================================
// TRANSACTION MOCK - ĐÃ SỬA
// ==========================================

// Khai báo sau khi db đã được khởi tạo.
// Không còn vòng tham chiếu typeof db.
const transactionMock = jest.fn(
  async (
    fn: (transaction: typeof db) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn(db);
  },
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
      subjectKey: string,
      key: string,
      scope: string,
      fn: (
        transaction: typeof db,
      ) => Promise<{
        statusCode: number;
        data: unknown;
      }>,
    ): Promise<unknown> => {
      const cacheKey =
        `${subjectKey}:${scope}:${key}`;

      if (replayCache.has(cacheKey)) {
        return replayCache.get(cacheKey);
      }

      const result = await fn(db);

      replayCache.set(
        cacheKey,
        result.data,
      );

      return result.data;
    },
  ),
};

// ==========================================
// TEST IDENTITY GUARD
// ==========================================

// Chỉ dùng token giả trong môi trường test.
// Không dùng trong production.
@Injectable()
class TestIdentityGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean {
    const req = context
      .switchToHttp()
      .getRequest<TestRequest>();

    // GET public Categories không cần token.
    if (
      req.method === 'GET' &&
      req.path === '/api/v1/categories'
    ) {
      return true;
    }

    const authorization =
      req.headers.authorization;

    if (
      authorization ===
      'Bearer test-admin-token'
    ) {
      req.user = {
        id: 1,
        role: UserRole.ADMIN,
      };

      return true;
    }

    if (
      authorization ===
      'Bearer test-staff-token'
    ) {
      req.user = {
        id: 2,
        role: UserRole.STAFF,
      };

      return true;
    }

    if (
      authorization ===
      'Bearer test-customer-token'
    ) {
      req.user = {
        id: 3,
        role: UserRole.CUSTOMER,
      };

      return true;
    }

    throw new UnauthorizedException();
  }
}

// ==========================================
// TEST DEPENDENCIES MODULE
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

// ==========================================
// E2E MODULE
// ==========================================

@Module({
  imports: [
    TestDependenciesModule,
    CategoriesModule,
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
class CategoriesE2eModule {}

// ==========================================
// E2E TEST SUITE
// ==========================================

describe('BE-02 Categories HTTP E2E', () => {
  let app: INestApplication<App>;

  const adminToken =
    'Bearer test-admin-token';

  const staffToken =
    'Bearer test-staff-token';

  const customerToken =
    'Bearer test-customer-token';

  // ========================================
  // BEFORE ALL
  // ========================================

  beforeAll(async () => {
    const fixture =
      await Test.createTestingModule({
        imports: [CategoriesE2eModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaStub)
        .overrideProvider(IdempotencyService)
        .useValue(idempotencyStub)
        .compile();

    app = fixture.createNestApplication();

    app.setGlobalPrefix('api/v1');

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory:
          validationExceptionFactory,
      }),
    );

    await app.init();
  });

  // ========================================
  // AFTER ALL
  // ========================================

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ========================================
  // BEFORE EACH
  // ========================================

  beforeEach(() => {
    rows.clear();
    replayCache.clear();

    nextId = 10;

    // Danh mục cha.
    rows.set(
      2,
      testCategory(),
    );

    // Danh mục con.
    rows.set(
      3,
      testCategory({
        id: 3,
        name: 'Váy công sở',
        slug: 'vay-cong-so',
        parentId: 2,
        version: 1,
      }),
    );

    // Danh mục độc lập.
    rows.set(
      4,
      testCategory({
        id: 4,
        name: 'Áo sơ mi',
        slug: 'ao-so-mi',
        parentId: null,
        version: 1,
      }),
    );

    jest.clearAllMocks();

    db.product.count.mockResolvedValue(0);
  });

  // ========================================
  // TEST 1 - GET PUBLIC
  // ========================================

  it(
    'GET Public không yêu cầu token',
    async () => {
      const result =
        await request(app.getHttpServer())
          .get(
            '/api/v1/categories?page=1&limit=20',
          )
          .expect(HttpStatus.OK);

      expect(
        result.body.data.items,
      ).toHaveLength(3);

      expect(result.body).toMatchObject({
        data: {
          pagination: {
            page: 1,
            limit: 20,
            total: 3,
          },
        },
        traceId: expect.any(String),
      });

      expect(
        result.headers['x-request-id'],
      ).toBe(result.body.traceId);
    },
  );

  // ========================================
  // TEST 2 - GET ADMIN WITHOUT TOKEN
  // ========================================

  it(
    'GET Admin không có token trả HTTP 401',
    async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .expect(HttpStatus.UNAUTHORIZED);
    },
  );

  // ========================================
  // TEST 3 - CUSTOMER FORBIDDEN
  // ========================================

  it(
    'CUSTOMER không được xem danh mục Admin',
    async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set(
          'Authorization',
          customerToken,
        )
        .expect(HttpStatus.FORBIDDEN);
    },
  );

  // ========================================
  // TEST 4 - STAFF GET ADMIN CATEGORIES
  // ========================================

  it(
    'STAFF xem danh mục Admin thành công',
    async () => {
      const result =
        await request(app.getHttpServer())
          .get('/api/v1/admin/categories')
          .set(
            'Authorization',
            staffToken,
          )
          .expect(HttpStatus.OK);

      expect(
        result.body.data.items,
      ).toHaveLength(3);
    },
  );

  // ========================================
  // TEST 5 - ADMIN CREATE
  // ========================================

  it(
    'ADMIN tạo danh mục và ghi AuditLog',
    async () => {
      const result =
        await request(app.getHttpServer())
          .post('/api/v1/admin/categories')
          .set(
            'Authorization',
            adminToken,
          )
          .set(
            'Idempotency-Key',
            'be02-e2e-create-0001',
          )
          .send({
            name: 'Chân váy',
            slug: 'chan-vay',
            parentId: null,
            isVisible: true,
          })
          .expect(HttpStatus.CREATED);

      expect(
        result.body.data,
      ).toMatchObject({
        id: '10',
        name: 'Chân váy',
        slug: 'chan-vay',
        isVisible: true,
        version: 1,
      });

      expect(
        db.auditLog.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 1,
          action: 'CATEGORY_CREATE',
          entityId: '10',
        }),
      });
    },
  );

  // ========================================
  // TEST 6 - IDEMPOTENCY REPLAY
  // ========================================

  it(
    'Cùng khóa POST không tạo trùng',
    async () => {
      const body = {
        name: 'Đồ ngủ',
        slug: 'do-ngu',
        parentId: null,
        isVisible: true,
      };

      const sendRequest = () =>
        request(app.getHttpServer())
          .post('/api/v1/admin/categories')
          .set(
            'Authorization',
            adminToken,
          )
          .set(
            'Idempotency-Key',
            'be02-e2e-replay-0001',
          )
          .send(body);

      const first =
        await sendRequest().expect(201);

      const second =
        await sendRequest().expect(201);

      expect(
        second.body.data.id,
      ).toBe(first.body.data.id);

      expect(
        db.category.create,
      ).toHaveBeenCalledTimes(1);

      expect(
        db.auditLog.create,
      ).toHaveBeenCalledTimes(1);
    },
  );

  // ========================================
  // TEST 7 - MISSING IDEMPOTENCY KEY
  // ========================================

  it(
    'Từ chối POST thiếu Idempotency-Key',
    async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set(
          'Authorization',
          adminToken,
        )
        .send({
          name: 'Danh mục thiếu khóa',
          slug: 'danh-muc-thieu-khoa',
          isVisible: true,
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(
        db.category.create,
      ).not.toHaveBeenCalled();
    },
  );

  // ========================================
  // TEST 8 - UNKNOWN FIELD
  // ========================================

  it(
    'Từ chối POST có trường dữ liệu lạ',
    async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set(
          'Authorization',
          adminToken,
        )
        .set(
          'Idempotency-Key',
          'be02-e2e-invalid-0001',
        )
        .send({
          name: 'Danh mục mới',
          slug: 'danh-muc-moi',
          isVisible: true,
          unknownField: 'not-allowed',
        })
        .expect(HttpStatus.BAD_REQUEST);
    },
  );

  // ========================================
  // TEST 9 - STAFF PATCH
  // ========================================

  it(
    'STAFF PATCH và tăng version',
    async () => {
      const result =
        await request(app.getHttpServer())
          .patch(
            '/api/v1/admin/categories/4',
          )
          .set(
            'Authorization',
            staffToken,
          )
          .send({
            version: 1,
            name: 'Áo sơ mi mới',
            isVisible: false,
          })
          .expect(HttpStatus.OK);

      expect(
        result.body.data,
      ).toMatchObject({
        id: '4',
        name: 'Áo sơ mi mới',
        isVisible: false,
        version: 2,
      });

      expect(
        db.auditLog.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 2,
          action: 'CATEGORY_UPDATE',
        }),
      });
    },
  );

  // ========================================
  // TEST 10 - OPTIMISTIC LOCKING
  // ========================================

  it(
    'PATCH version cũ trả HTTP 409',
    async () => {
      await request(app.getHttpServer())
        .patch(
          '/api/v1/admin/categories/2',
        )
        .set(
          'Authorization',
          adminToken,
        )
        .send({
          version: 1,
          name: 'Tên bị từ chối',
        })
        .expect(HttpStatus.CONFLICT);

      expect(
        rows.get(2)?.name,
      ).toBe('Váy thời trang nữ');

      expect(
        rows.get(2)?.version,
      ).toBe(2);
    },
  );

  // ========================================
  // TEST 11 - CATEGORY CYCLE
  // ========================================

  it(
    'PATCH tạo chu trình cha/con trả HTTP 409',
    async () => {
      await request(app.getHttpServer())
        .patch(
          '/api/v1/admin/categories/2',
        )
        .set(
          'Authorization',
          adminToken,
        )
        .send({
          version: 2,
          parentId: '3',
        })
        .expect(HttpStatus.CONFLICT);

      expect(
        rows.get(2)?.parentId,
      ).toBeNull();

      expect(
        rows.get(3)?.parentId,
      ).toBe(2);
    },
  );

  // ========================================
  // TEST 12 - STAFF DELETE FORBIDDEN
  // ========================================

  it(
    'STAFF không được DELETE danh mục',
    async () => {
      await request(app.getHttpServer())
        .delete(
          '/api/v1/admin/categories/4',
        )
        .set(
          'Authorization',
          staffToken,
        )
        .set(
          'If-Match',
          '"1"',
        )
        .expect(HttpStatus.FORBIDDEN);

      expect(
        rows.has(4),
      ).toBe(true);

      expect(
        db.category.deleteMany,
      ).not.toHaveBeenCalled();
    },
  );

  // ========================================
  // TEST 13 - DELETE CATEGORY WITH CHILDREN
  // ========================================

  it(
    'ADMIN không được xóa danh mục đang có con',
    async () => {
      await request(app.getHttpServer())
        .delete(
          '/api/v1/admin/categories/2',
        )
        .set(
          'Authorization',
          adminToken,
        )
        .set(
          'If-Match',
          '"2"',
        )
        .expect(HttpStatus.CONFLICT);

      expect(
        rows.has(2),
      ).toBe(true);

      expect(
        rows.has(3),
      ).toBe(true);
    },
  );

  // ========================================
  // TEST 14 - ADMIN DELETE SUCCESS
  // ========================================

  it(
    'ADMIN DELETE trả HTTP 204',
    async () => {
      const result =
        await request(app.getHttpServer())
          .delete(
            '/api/v1/admin/categories/4',
          )
          .set(
            'Authorization',
            adminToken,
          )
          .set(
            'If-Match',
            '"1"',
          )
          .expect(
            HttpStatus.NO_CONTENT,
          );

      expect(result.text).toBe('');

      expect(
        rows.has(4),
      ).toBe(false);

      expect(
        db.auditLog.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 1,
          action: 'CATEGORY_DELETE',
          entityId: '4',
        }),
      });
    },
  );
});
