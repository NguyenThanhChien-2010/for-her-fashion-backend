import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { PinoLogger } from 'nestjs-pino';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';

import {
  APP_GUARD,
  APP_INTERCEPTOR,
} from '@nestjs/core';

import { Test } from '@nestjs/testing';
import { ProductStatus } from '@prisma/client';

import request from 'supertest';
import type { App } from 'supertest/types';

import { PublicProductVariantsController } from '../src/modules/products/public-product-variants.controller';
import { PublicProductVariantsService } from '../src/modules/products/public-product-variants.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

const variants = [
  {
    id: 1,
    productId: 3,
    colorId: 1,
    sizeCode: 'M',
    sku: 'BE02-TEST-P3-RED-M',
    isActive: true,
    version: 2,
  },
  {
    id: 2,
    productId: 3,
    colorId: 1,
    sizeCode: 'L',
    sku: 'BE02-TEST-P3-RED-L',
    isActive: true,
    version: 1,
  },
  {
    id: 3,
    productId: 3,
    colorId: 2,
    sizeCode: 'M',
    sku: 'BE02-TEST-P3-BLUE-M',
    isActive: true,
    version: 1,
  },
  {
    id: 4,
    productId: 3,
    colorId: 2,
    sizeCode: 'L',
    sku: 'BE02-INACTIVE-SKU',
    isActive: false,
    version: 1,
  },
  {
    id: 5,
    productId: 4,
    colorId: 1,
    sizeCode: 'M',
    sku: 'BE02-OTHER-PRODUCT',
    isActive: true,
    version: 1,
  },
];

interface VariantWhere {
  productId: number;
  isActive: boolean;
  colorId?: number;
  sizeCode?: string;
}

function filterVariants(where: VariantWhere) {
  return variants.filter(
    (row) =>
      row.productId === where.productId &&
      row.isActive === where.isActive &&
      (
        where.colorId === undefined ||
        row.colorId === where.colorId
      ) &&
      (
        where.sizeCode === undefined ||
        row.sizeCode === where.sizeCode
      ),
  );
}

const prismaMock = {
  product: {
    findFirst: jest.fn(
      ({
        where,
      }: {
        where: {
          id: number;
          status: ProductStatus;
        };
      }) => {
        if (
          where.id === 3 &&
          where.status === ProductStatus.ACTIVE
        ) {
          return { id: 3 };
        }

        return null;
      },
    ),
  },
  productVariant: {
    count: jest.fn(
      ({ where }: { where: VariantWhere }) =>
        filterVariants(where).length,
    ),

    findMany: jest.fn(
      ({
        where,
        skip,
        take,
      }: {
        where: VariantWhere;
        skip: number;
        take: number;
      }) =>
        filterVariants(where)
          .sort((a, b) => a.id - b.id)
          .slice(skip, skip + take),
    ),
  },
};

describe('BE-02 M02 Public Product Variants HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = '/api/v1/products/3/variants';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        PublicProductVariantsController,
      ],
      providers: [
        PublicProductVariantsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: APP_GUARD,
          useClass: JwtAuthGuard,
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
    }).compile();

    app = moduleRef.createNestApplication();

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
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows public requests without JWT - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint);

    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      data: {
        items: [
          { id: '1' },
          { id: '2' },
          { id: '3' },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 3,
        },
      },
      traceId: expect.any(String),
    });
  });

  it('does not expose inactive or unrelated variants', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint);

    expect(res.status).toBe(200);

    expect(JSON.stringify(res.body)).not.toContain(
      'BE02-INACTIVE-SKU',
    );

    expect(JSON.stringify(res.body)).not.toContain(
      'BE02-OTHER-PRODUCT',
    );
  });

  it('filters by colorId - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        colorId: '1',
      });

    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      data: {
        items: [
          { id: '1', colorId: '1' },
          { id: '2', colorId: '1' },
        ],
        pagination: {
          total: 2,
        },
      },
    });
  });

  it('filters by sizeCode - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        sizeCode: 'M',
      });

    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      data: {
        items: [
          { id: '1', sizeCode: 'M' },
          { id: '3', sizeCode: 'M' },
        ],
        pagination: {
          total: 2,
        },
      },
    });
  });

  it('combines color and size filters - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        colorId: '1',
        sizeCode: 'M',
      });

    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      data: {
        items: [
          {
            id: '1',
            colorId: '1',
            sizeCode: 'M',
            sku: 'BE02-TEST-P3-RED-M',
          },
        ],
        pagination: {
          total: 1,
        },
      },
    });
  });

  it('returns empty list for inactive combination', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        colorId: '2',
        sizeCode: 'L',
      });

    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      data: {
        items: [],
        pagination: {
          total: 0,
        },
      },
    });
  });

  it('supports pagination - 200', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        page: 2,
        limit: 2,
      });

    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      data: {
        items: [
          { id: '3' },
        ],
        pagination: {
          page: 2,
          limit: 2,
          total: 3,
        },
      },
    });
  });

  it('returns 404 for nonexistent product', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/products/999/variants');

    expect(res.status).toBe(404);
  });

  it('returns 404 for hidden product', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/products/4/variants');

    expect(res.status).toBe(404);
  });

  it('rejects invalid productId - 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/products/abc/variants');

    expect(res.status).toBe(400);
  });

  it('rejects invalid colorId - 400', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        colorId: 'abc',
      });

    expect(res.status).toBe(400);
  });

  it('rejects invalid page - 400', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        page: 0,
      });

    expect(res.status).toBe(400);
  });

  it('rejects limit above 100 - 400', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        limit: 101,
      });

    expect(res.status).toBe(400);
  });

  it('rejects unknown query parameters - 400', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint)
      .query({
        unknownField: 'test',
      });

    expect(res.status).toBe(400);
  });
});