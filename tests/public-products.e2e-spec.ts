
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
  product: {
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

// ProductsModule còn có ProductsService dành cho Admin.
// Cung cấp dependency giả để NestJS khởi tạo được module.
const idempotencyMock = {
  execute: jest.fn(),
};

// ==========================================
// TEST AUTH GUARD
// ==========================================

// Guard giả lập cách JwtAuthGuard nhận biết @Public().
// Nếu endpoint chưa được đánh dấu Public, request không
// có token phải bị từ chối.
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
// HTTP E2E TESTS
// ==========================================

describe('BE-02 Public Product Detail HTTP E2E', () => {
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
  });

  it('PUBLIC: không cần token vẫn xem được sản phẩm ACTIVE - 200', async () => {
    const response = await request(
      app.getHttpServer(),
    )
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

    expect(
      typeof response.body.traceId,
    ).toBe('string');

    expect(
      response.body.traceId.length,
    ).toBeGreaterThan(0);

    expect(
      prismaMock.product.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 3,
          status: ProductStatus.ACTIVE,
        },
      }),
    );
  });

  it('PUBLIC: sản phẩm HIDDEN trả 404', async () => {
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

  it('PUBLIC: sản phẩm DISCONTINUED trả 404', async () => {
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

  it('PUBLIC: sản phẩm DRAFT trả 404', async () => {
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

  it('PUBLIC: sản phẩm không tồn tại trả 404', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/999999`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('PUBLIC: ID không hợp lệ trả 400', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/abc`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('PUBLIC: ID vượt phạm vi số nguyên an toàn trả 400', async () => {
    await request(app.getHttpServer())
      .get(
        `${endpoint}/9999999999999999999999`,
      )
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.product.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('PUBLIC: imageFileIds được trả về theo sortOrder', async () => {
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

    const response = await request(
      app.getHttpServer(),
    )
      .get(`${endpoint}/3`)
      .expect(HttpStatus.OK);

    expect(
      response.body.data.imageFileIds,
    ).toEqual(['102', '101']);
  });
});
