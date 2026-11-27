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

import {
  UserRole,
} from '@prisma/client';

import request from 'supertest';
import type { App } from 'supertest/types';

import {
  AdminColorsController,
  AdminSizesController,
} from '../src/modules/products/admin-product-options.controller';

import { ProductOptionsService } from '../src/modules/products/product-options.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// ==========================================
// PRISMA MOCK
// ==========================================

const prismaMock = {
  color: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  size: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

// ==========================================
// AUTH GUARD GIẢ LẬP CHO E2E
// ==========================================

// Không dùng JWT thật.
// Các header test-admin, test-staff và
// test-customer chỉ có hiệu lực trong test này.
@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: {
        authorization?: string;
      };
      user?: {
        role: UserRole;
      };
    }>();

    const authorization = req.headers.authorization;

    if (authorization === 'Bearer test-admin') {
      req.user = { role: UserRole.ADMIN };
      return true;
    }

    if (authorization === 'Bearer test-staff') {
      req.user = { role: UserRole.STAFF };
      return true;
    }

    if (authorization === 'Bearer test-customer') {
      req.user = { role: UserRole.CUSTOMER };
      return true;
    }

    throw new UnauthorizedException();
  }
}

// ==========================================
// TEST MODULE
// ==========================================

@Module({
  controllers: [
    AdminColorsController,
    AdminSizesController,
  ],
  providers: [
    ProductOptionsService,
    {
      provide: PrismaService,
      useValue: prismaMock,
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
class ProductOptionsE2eModule {}

// ==========================================
// HTTP E2E TESTS
// ==========================================

describe('BE-02 Product Options HTTP E2E', () => {
  let app: INestApplication<App>;

  const colorsUrl = '/api/v1/admin/colors';
  const sizesUrl = '/api/v1/admin/sizes';

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [ProductOptionsE2eModule],
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
    jest.clearAllMocks();

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

    prismaMock.color.count.mockResolvedValue(2);

    prismaMock.size.findMany.mockResolvedValue([
      {
        code: 'M',
        name: 'Medium',
        skuSuffix: 'BE02M',
      },
      {
        code: 'L',
        name: 'Large',
        skuSuffix: 'BE02L',
      },
    ]);

    prismaMock.size.count.mockResolvedValue(2);
  });

  it('COLORS: ADMIN lấy danh sách thành công - 200', async () => {
    const response = await request(app.getHttpServer())
      .get(colorsUrl)
      .set('Authorization', 'Bearer test-admin')
      .expect(HttpStatus.OK);

    expect(response.body.data.items).toHaveLength(2);

    expect(response.body.data.items[0]).toEqual({
      id: '1',
      name: 'BE02 TEST Đỏ',
      skuSuffix: 'B02RED',
      groupId: '1',
    });

    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 2,
    });
  });

  it('SIZES: STAFF lấy danh sách thành công - 200', async () => {
    const response = await request(app.getHttpServer())
      .get(sizesUrl)
      .set('Authorization', 'Bearer test-staff')
      .expect(HttpStatus.OK);

    expect(response.body.data.items).toEqual([
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
    ]);
  });

  it('COLORS: không có token trả 401', async () => {
    await request(app.getHttpServer())
      .get(colorsUrl)
      .expect(HttpStatus.UNAUTHORIZED);

    expect(
      prismaMock.color.findMany,
    ).not.toHaveBeenCalled();
  });

  it('SIZES: không có token trả 401', async () => {
    await request(app.getHttpServer())
      .get(sizesUrl)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('COLORS: CUSTOMER không có quyền trả 403', async () => {
    await request(app.getHttpServer())
      .get(colorsUrl)
      .set('Authorization', 'Bearer test-customer')
      .expect(HttpStatus.FORBIDDEN);

    expect(
      prismaMock.color.findMany,
    ).not.toHaveBeenCalled();
  });

  it('SIZES: CUSTOMER không có quyền trả 403', async () => {
    await request(app.getHttpServer())
      .get(sizesUrl)
      .set('Authorization', 'Bearer test-customer')
      .expect(HttpStatus.FORBIDDEN);
  });

  it('COLORS: page=0 trả HTTP 400', async () => {
    await request(app.getHttpServer())
      .get(`${colorsUrl}?page=0`)
      .set('Authorization', 'Bearer test-admin')
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.color.findMany,
    ).not.toHaveBeenCalled();
  });

  it('SIZES: limit=101 trả HTTP 400', async () => {
    await request(app.getHttpServer())
      .get(`${sizesUrl}?limit=101`)
      .set('Authorization', 'Bearer test-admin')
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.size.findMany,
    ).not.toHaveBeenCalled();
  });
});
