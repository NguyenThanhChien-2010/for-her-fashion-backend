import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { PinoLogger } from 'nestjs-pino';

import {
  CanActivate,
  ExecutionContext,
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

import { AdminProductVariantsController } from '../src/modules/products/admin-product-variants.controller';
import { ProductVariantsService } from '../src/modules/products/product-variants.service';

import { PrismaService } from '../src/modules/prisma/prisma.service';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { RolesGuard } from '../src/common/guards/roles.guard';

import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

const tx = {
  $queryRaw: jest.fn(),
  product: {
    findUnique: jest.fn(),
  },
  color: {
    findUnique: jest.fn(),
  },
  size: {
    findUnique: jest.fn(),
  },
  productVariant: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  inventory: {
    create: jest.fn(),
    update: jest.fn(),
  },
};

const idempotencyMock = {
  execute: jest.fn(),
};

@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: { id: number; role: UserRole };
    }>();

    switch (req.headers.authorization) {
      case 'Bearer test-admin':
        req.user = { id: 1, role: UserRole.ADMIN };
        return true;

      case 'Bearer test-staff':
        req.user = { id: 2, role: UserRole.STAFF };
        return true;

      case 'Bearer test-customer':
        req.user = { id: 3, role: UserRole.CUSTOMER };
        return true;

      default:
        throw new UnauthorizedException();
    }
  }
}

@Module({
  controllers: [AdminProductVariantsController],
  providers: [
    ProductVariantsService,
    {
      provide: PrismaService,
      useValue: {},
    },
    {
      provide: IdempotencyService,
      useValue: idempotencyMock,
    },
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
class ProductVariantsE2eModule {}

describe('BE-02 ProductVariant HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint =
    '/api/v1/admin/products/3/variants';

  const validKey =
    'be02-e2e-variant-key-0001';

  const validBody = {
    colorId: '1',
    sizeCode: 'M',
  };

  const adminRequest = () =>
    request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', validKey);

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [ProductVariantsE2eModule],
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
    jest.resetAllMocks();

    tx.$queryRaw.mockResolvedValue([{ baseCode: 'AD10005' }]);
    tx.product.findUnique.mockResolvedValue({
      id: 3,
      baseCode: 'AD10005',
    });

    tx.color.findUnique.mockResolvedValue({
      id: 1,
      skuSuffix: 'B02RED',
    });

    tx.size.findUnique.mockResolvedValue({
      code: 'M',
      skuSuffix: 'BE02M',
      isActive: true,
    });

    tx.productVariant.findFirst.mockResolvedValue(null);

    tx.productVariant.create.mockResolvedValue({
      id: 10,
      productId: 3,
      colorId: 1,
      sizeCode: 'M',
      sku: 'AD10005B02REDBE02M',
      isActive: true,
      version: 1,
    });

    tx.auditLog.create.mockResolvedValue({
      id: 1,
    });

    idempotencyMock.execute.mockImplementation(
      async (
        _subject: string,
        _key: string,
        _scope: string,
        callback: (transaction: typeof tx) => Promise<{
          statusCode: number;
          data: unknown;
        }>,
      ) => {
        const result = await callback(tx);
        return result.data;
      },
    );
  });

  it('1. ADMIN tạo biến thể và sinh SKU - 201', async () => {
    const response = await adminRequest()
      .send(validBody)
      .expect(HttpStatus.CREATED);

    expect(response.body.data).toEqual({
      id: '10',
      productId: '3',
      colorId: '1',
      sizeCode: 'M',
      sku: 'AD10005B02REDBE02M',
      status: 'ACTIVE',
      version: 1,
    });

    expect(response.body.traceId).toEqual(
      expect.any(String),
    );

    expect(tx.productVariant.create).toHaveBeenCalledTimes(1);
  });

  it('2. Không đăng nhập - 401', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Idempotency-Key', validKey)
      .send(validBody)
      .expect(HttpStatus.UNAUTHORIZED);

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('3. STAFF không được tạo - 403', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-staff')
      .set('Idempotency-Key', validKey)
      .send(validBody)
      .expect(HttpStatus.FORBIDDEN);

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('4. CUSTOMER không được tạo - 403', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-customer')
      .set('Idempotency-Key', validKey)
      .send(validBody)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('5. Thiếu Idempotency-Key - 400', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .send(validBody)
      .expect(HttpStatus.BAD_REQUEST);

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('6. Client tự truyền SKU - 400', async () => {
    await adminRequest()
      .send({
        ...validBody,
        sku: 'SKU-TU-NHAP',
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('7. Color ID sai định dạng - 400', async () => {
    await adminRequest()
      .send({
        colorId: 'abc',
        sizeCode: 'M',
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('8. SizeCode rỗng - 400', async () => {
    await adminRequest()
      .send({
        colorId: '1',
        sizeCode: '',
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('9. Product không tồn tại - 404', async () => {
    tx.product.findUnique.mockResolvedValue(null);

    await adminRequest()
      .send(validBody)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('10. SKU đã tồn tại - 409', async () => {
    tx.productVariant.findFirst.mockResolvedValue({
      id: 99,
    });

    await adminRequest()
      .send(validBody)
      .expect(HttpStatus.CONFLICT);

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('11. Size không hoạt động - 400', async () => {
    tx.size.findUnique.mockResolvedValue({
      code: 'M',
      skuSuffix: 'BE02M',
      isActive: false,
    });

    await adminRequest()
      .send(validBody)
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('12. Tạo SKU không thay đổi tồn kho', async () => {
    await adminRequest()
      .send(validBody)
      .expect(HttpStatus.CREATED);

    expect(tx.inventory.create).not.toHaveBeenCalled();
    expect(tx.inventory.update).not.toHaveBeenCalled();

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
