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
// BE-02 / M02
// ADMIN SIZE CHART DETAIL HTTP E2E
//
// Test qua HTTP NestJS.
// Prisma duoc mock, khong thay doi MySQL.
// ==========================================

// ==========================================
// MOCK DATABASE
// ==========================================

const prismaMock = {
  sizeChart: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
};

const idempotencyMock = {
  execute: jest.fn(),
};

// ==========================================
// TEST AUTH GUARD
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
class SizeChartDetailE2eModule {}

// ==========================================
// HTTP E2E TESTS
// ==========================================

describe('BE-02 SizeCharts - GET Detail HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint =
    '/api/v1/admin/size-charts';

  // ========================================
  // TEST DATA
  // ========================================

  const productChart = {
    id: 3,
    name: 'Bảng số đo riêng áo thun nữ - PRODUCT',
    unit: 'cm',
    version: 1,
    isActive: true,
    products: [{ id: 3 }],
    categories: [],
    rows: [
      {
        sizeCode: 'L',
        measurements: {
          chest: 94,
          waist: 76,
          length: 66,
        },
      },
      {
        sizeCode: 'M',
        measurements: {
          chest: 88,
          waist: 70,
          length: 63,
        },
      },
    ],
  };

  const groupChart = {
    id: 2,
    name: 'Bảng số đo áo sơ mi - GROUP',
    unit: 'cm',
    version: 1,
    isActive: true,
    products: [],
    categories: [{ id: 4 }],
    rows: [
      {
        sizeCode: 'L',
        measurements: {
          chest: 100,
          waist: 84,
          length: 68,
        },
      },
      {
        sizeCode: 'M',
        measurements: {
          chest: 94,
          waist: 78,
          length: 65,
        },
      },
    ],
  };

  const getWithRole = (
    chartId: string,
    role: string,
  ) =>
    request(app.getHttpServer())
      .get(`${endpoint}/${chartId}`)
      .set('Authorization', `Bearer ${role}`);

  // ========================================
  // INITIALIZE APP
  // ========================================

  beforeAll(async () => {
    const fixture =
      await Test.createTestingModule({
        imports: [SizeChartDetailE2eModule],
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

    prismaMock.sizeChart.findUnique
      .mockResolvedValue(productChart);

    prismaMock.sizeChart.findMany
      .mockResolvedValue([]);

    prismaMock.sizeChart.count
      .mockResolvedValue(0);
  });

  // ========================================
  // TEST 1 - ADMIN PRODUCT
  // ========================================

  it('1. ADMIN xem chi tiết PRODUCT - 200', async () => {
    const response =
      await getWithRole('3', 'test-admin')
        .expect(HttpStatus.OK);

    expect(response.body.data).toEqual({
      id: '3',
      name:
        'Bảng số đo riêng áo thun nữ - PRODUCT',
      scopeType: 'PRODUCT',
      scopeId: '3',
      unit: 'cm',
      rows: [
        {
          sizeCode: 'L',
          measurements: {
            chest: 94,
            waist: 76,
            length: 66,
          },
        },
        {
          sizeCode: 'M',
          measurements: {
            chest: 88,
            waist: 70,
            length: 63,
          },
        },
      ],
      version: 1,
    });

    expect(response.body.traceId).toEqual(
      expect.any(String),
    );

    expect(
      prismaMock.sizeChart.findUnique,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3 },
      }),
    );
  });

  // ========================================
  // TEST 2 - STAFF GROUP
  // ========================================

  it('2. STAFF xem chi tiết GROUP - 200', async () => {
    prismaMock.sizeChart.findUnique
      .mockResolvedValue(groupChart);

    const response =
      await getWithRole('2', 'test-staff')
        .expect(HttpStatus.OK);

    expect(response.body.data).toMatchObject({
      id: '2',
      name: 'Bảng số đo áo sơ mi - GROUP',
      scopeType: 'GROUP',
      scopeId: '4',
      unit: 'cm',
      version: 1,
    });

    expect(response.body.data.rows).toHaveLength(2);
  });

  // ========================================
  // TEST 3 - NO TOKEN
  // ========================================

  it('3. Không có JWT trả HTTP 401', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/3`)
      .expect(HttpStatus.UNAUTHORIZED);

    expect(
      prismaMock.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 4 - CUSTOMER
  // ========================================

  it('4. CUSTOMER không có quyền - 403', async () => {
    await getWithRole('3', 'test-customer')
      .expect(HttpStatus.FORBIDDEN);

    expect(
      prismaMock.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 5 - INVALID ID
  // ========================================

  it('5. chartId=abc trả HTTP 400', async () => {
    await getWithRole('abc', 'test-admin')
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 6 - ZERO ID
  // ========================================

  it('6. chartId=0 trả HTTP 400', async () => {
    await getWithRole('0', 'test-admin')
      .expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 7 - UNSAFE ID
  // ========================================

  it('7. ID vượt phạm vi an toàn trả 400', async () => {
    await getWithRole(
      '999999999999999999999',
      'test-admin',
    ).expect(HttpStatus.BAD_REQUEST);

    expect(
      prismaMock.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 8 - NOT FOUND
  // ========================================

  it('8. Bảng không tồn tại trả HTTP 404', async () => {
    prismaMock.sizeChart.findUnique
      .mockResolvedValue(null);

    const response =
      await getWithRole(
        '999999',
        'test-admin',
      ).expect(HttpStatus.NOT_FOUND);

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ========================================
  // TEST 9 - MISSING SCOPE
  // ========================================

  it('9. Bảng thiếu phạm vi trả 409', async () => {
    prismaMock.sizeChart.findUnique
      .mockResolvedValue({
        ...productChart,
        products: [],
        categories: [],
      });

    await getWithRole('3', 'test-admin')
      .expect(HttpStatus.CONFLICT);
  });

  // ========================================
  // TEST 10 - MULTIPLE SCOPES
  // ========================================

  it('10. Bảng có hai phạm vi trả 409', async () => {
    prismaMock.sizeChart.findUnique
      .mockResolvedValue({
        ...productChart,
        products: [{ id: 3 }],
        categories: [{ id: 4 }],
      });

    await getWithRole('3', 'test-staff')
      .expect(HttpStatus.CONFLICT);
  });

  // ========================================
  // TEST 11 - INACTIVE CHART
  // ========================================

  it('11. ADMIN xem bảng INACTIVE - 200', async () => {
    prismaMock.sizeChart.findUnique
      .mockResolvedValue({
        ...productChart,
        isActive: false,
      });

    const response =
      await getWithRole('3', 'test-admin')
        .expect(HttpStatus.OK);

    expect(response.body.data).toMatchObject({
      id: '3',
      scopeType: 'PRODUCT',
      scopeId: '3',
    });
  });
});
