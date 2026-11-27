import { createCatalogTestApp, CatalogTestAuthGuard, catalogAdminProviders } from './helpers/catalog-e2e.helper';



import { HttpStatus, INestApplication, Module } from '@nestjs/common';



import { Test } from '@nestjs/testing';


import request from 'supertest';
import type { App } from 'supertest/types';

import {
  AdminSizeChartsController,
} from '../src/modules/products/admin-size-charts.controller';

import {
  SizeChartsService,
} from '../src/modules/products/size-charts.service';











// ==========================================
// MOCK PRISMA
// ==========================================

const prismaMock = {
  sizeChart: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const tx = {
  product: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  category: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  size: {
    findMany: jest.fn(),
  },
  sizeChart: {
    create: jest.fn(),
  },
};

// ==========================================
// MOCK IDEMPOTENCY
// ==========================================

const idempotencyMock = {
  execute: jest.fn(),
};

// ==========================================
// AUTH GUARD CHI DANH CHO TEST
// ==========================================


// ==========================================
// TEST MODULE
// ==========================================

@Module({
  controllers: [
    AdminSizeChartsController,
  ],

  providers: catalogAdminProviders(SizeChartsService, prismaMock, idempotencyMock, CatalogTestAuthGuard),
})
class SizeChartsE2eModule {}

// ==========================================
// SIZE CHARTS HTTP E2E
// ==========================================

describe('BE-02 SizeCharts HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = '/api/v1/admin/size-charts';

  const validKey = 'be02-size-chart-e2e-key-0001';

  const validBody = {
    name: 'Bảng số đo váy công sở',
    scopeType: 'GROUP',
    scopeId: '3',
    unit: 'cm',
    rows: [
      {
        sizeCode: 'M',
        measurements: {
          chest: 90,
          waist: 72,
          hip: 96,
        },
      },
      {
        sizeCode: 'L',
        measurements: {
          chest: 94,
          waist: 76,
          hip: 100,
        },
      },
    ],
  };

  const adminGet = (url = endpoint) =>
    request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer test-admin');

  const adminPost = () =>
    request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', validKey);

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [SizeChartsE2eModule],
    }).compile();

    app = await createCatalogTestApp(fixture);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.resetAllMocks();

    // GET
    prismaMock.sizeChart.findMany.mockResolvedValue([]);
    prismaMock.sizeChart.count.mockResolvedValue(0);

    // POST
    tx.product.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: null,
    });

    tx.category.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: null,
    });

    tx.size.findMany.mockResolvedValue([
      { code: 'M' },
      { code: 'L' },
    ]);

    tx.sizeChart.create.mockResolvedValue({
      id: 10,
      name: 'Bảng số đo váy công sở',
      unit: 'cm',
      version: 1,
    });

    tx.product.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.category.updateMany.mockResolvedValue({
      count: 1,
    });

    idempotencyMock.execute.mockImplementation(
      async (
        _subject: string,
        _key: string,
        _scope: string,
        callback: (
          transaction: typeof tx,
        ) => Promise<{
          statusCode: number;
          data: unknown;
        }>,
      ) => {
        const result = await callback(tx);
        return result.data;
      },
    );
  });

  // ==========================================
  // GET - 10 BAI TEST CU
  // ==========================================

  it('1. ADMIN xem danh sách rỗng - 200', async () => {
    const response = await adminGet()
      .expect(HttpStatus.OK);

    expect(response.body.data).toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });

    expect(response.body.traceId).toEqual(
      expect.any(String),
    );
  });

  it('2. STAFF được xem danh sách - 200', async () => {
    await request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', 'Bearer test-staff')
      .expect(HttpStatus.OK);
  });

  it('3. Không có token - 401', async () => {
    await request(app.getHttpServer())
      .get(endpoint)
      .expect(HttpStatus.UNAUTHORIZED);

    expect(
      prismaMock.sizeChart.findMany,
    ).not.toHaveBeenCalled();
  });

  it('4. CUSTOMER không có quyền - 403', async () => {
    await request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', 'Bearer test-customer')
      .expect(HttpStatus.FORBIDDEN);

    expect(
      prismaMock.sizeChart.findMany,
    ).not.toHaveBeenCalled();
  });

  it('5. page=0 trả 400', async () => {
    await adminGet(`${endpoint}?page=0`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.sizeChart.findMany,
    ).not.toHaveBeenCalled();
  });

  it('6. limit=101 trả 400', async () => {
    await adminGet(`${endpoint}?limit=101`)
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.sizeChart.findMany,
    ).not.toHaveBeenCalled();
  });

  it('7. Phân trang page=2 limit=5', async () => {
    const response = await adminGet(
      `${endpoint}?page=2&limit=5`,
    ).expect(HttpStatus.OK);

    expect(
      prismaMock.sizeChart.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
      }),
    );

    expect(response.body.data.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 0,
    });
  });

  it('8. Trả bảng số đo của sản phẩm - 200', async () => {
    prismaMock.sizeChart.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Bảng số đo sản phẩm',
        unit: 'cm',
        version: 1,
        products: [{ id: 3 }],
        categories: [],
        rows: [
          {
            sizeCode: 'M',
            measurements: {
              chest: 96,
              waist: 80,
            },
          },
        ],
      },
    ]);

    prismaMock.sizeChart.count.mockResolvedValue(1);

    const response = await adminGet()
      .expect(HttpStatus.OK);

    expect(response.body.data.items[0]).toEqual({
      id: '1',
      name: 'Bảng số đo sản phẩm',
      scopeType: 'PRODUCT',
      scopeId: '3',
      unit: 'cm',
      rows: [
        {
          sizeCode: 'M',
          measurements: {
            chest: 96,
            waist: 80,
          },
        },
      ],
      version: 1,
    });
  });

  it('9. Trả bảng số đo của danh mục - 200', async () => {
    prismaMock.sizeChart.findMany.mockResolvedValue([
      {
        id: 2,
        name: 'Bảng số đo danh mục',
        unit: 'cm',
        version: 1,
        products: [],
        categories: [{ id: 2 }],
        rows: [
          {
            sizeCode: 'L',
            measurements: {
              waist: 76,
              hip: 100,
            },
          },
        ],
      },
    ]);

    prismaMock.sizeChart.count.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', 'Bearer test-staff')
      .expect(HttpStatus.OK);

    expect(response.body.data.items[0]).toMatchObject({
      id: '2',
      scopeType: 'GROUP',
      scopeId: '2',
    });
  });

  it('10. Bảng chưa có phạm vi trả 409', async () => {
    prismaMock.sizeChart.findMany.mockResolvedValue([
      {
        id: 3,
        name: 'Bảng chưa gán',
        unit: 'cm',
        version: 1,
        products: [],
        categories: [],
        rows: [],
      },
    ]);

    await adminGet()
      .expect(HttpStatus.CONFLICT);
  });

  // ==========================================
  // POST - 9 BAI TEST MOI
  // ==========================================

  it('11. ADMIN tạo bảng số đo GROUP - 201', async () => {
    const response = await adminPost()
      .send(validBody)
      .expect(HttpStatus.CREATED);

    expect(response.body.data).toEqual({
      id: '10',
      name: 'Bảng số đo váy công sở',
      scopeType: 'GROUP',
      scopeId: '3',
      unit: 'cm',
      rows: [
        {
          sizeCode: 'L',
          measurements: {
            chest: 94,
            hip: 100,
            waist: 76,
          },
        },
        {
          sizeCode: 'M',
          measurements: {
            chest: 90,
            hip: 96,
            waist: 72,
          },
        },
      ],
      version: 1,
    });

    expect(response.body.traceId).toEqual(
      expect.any(String),
    );

    expect(tx.sizeChart.create).toHaveBeenCalledTimes(1);
    expect(tx.category.updateMany).toHaveBeenCalledTimes(1);
  });

  it('12. STAFF được tạo bảng số đo - 201', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-staff')
      .set('Idempotency-Key', validKey)
      .send(validBody)
      .expect(HttpStatus.CREATED);

    expect(idempotencyMock.execute).toHaveBeenCalledWith(
      '2',
      validKey,
      'admin.size-charts.create',
      expect.any(Function),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it('13. Không có token khi POST - 401', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Idempotency-Key', validKey)
      .send(validBody)
      .expect(HttpStatus.UNAUTHORIZED);

    expect(idempotencyMock.execute).not.toHaveBeenCalled();
  });

  it('14. CUSTOMER không được POST - 403', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-customer')
      .set('Idempotency-Key', validKey)
      .send(validBody)
      .expect(HttpStatus.FORBIDDEN);

    expect(idempotencyMock.execute).not.toHaveBeenCalled();
  });

  it('15. Thiếu Idempotency-Key - 400', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .send(validBody)
      .expect(HttpStatus.BAD_REQUEST);

    expect(idempotencyMock.execute).not.toHaveBeenCalled();
  });

  it('16. Có trường thừa trong body - 400', async () => {
    await adminPost()
      .send({
        ...validBody,
        unknownField: 'not-allowed',
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(idempotencyMock.execute).not.toHaveBeenCalled();
  });

  it('17. Rows rỗng - 400', async () => {
    await adminPost()
      .send({
        ...validBody,
        rows: [],
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(tx.sizeChart.create).not.toHaveBeenCalled();
  });

  it('18. Phạm vi đã có bảng số đo - 409', async () => {
    tx.category.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: 5,
    });

    await adminPost()
      .send(validBody)
      .expect(HttpStatus.CONFLICT);

    expect(tx.sizeChart.create).not.toHaveBeenCalled();
  });

  it('19. Tạo bảng số đo PRODUCT - 201', async () => {
    const response = await adminPost()
      .send({
        ...validBody,
        scopeType: 'PRODUCT',
      })
      .expect(HttpStatus.CREATED);

    expect(response.body.data).toMatchObject({
      scopeType: 'PRODUCT',
      scopeId: '3',
    });

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 3,
        sizeChartId: null,
      },
      data: {
        sizeChartId: 10,
      },
    });

    expect(tx.category.updateMany).not.toHaveBeenCalled();
  });
});
