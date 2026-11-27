import { createCatalogTestApp, catalogAdminProviders, createSizeChartPatchTxMock } from './helpers/catalog-e2e.helper';

import { CanActivate, ExecutionContext, HttpStatus, Injectable, INestApplication, Module, UnauthorizedException } from '@nestjs/common';


import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';

import request from 'supertest';
import type { App } from 'supertest/types';

import { AdminSizeChartsController } from '../src/modules/products/admin-size-charts.controller';
import { SizeChartsService } from '../src/modules/products/size-charts.service';






// ==========================================
// BE-02 M02 - PATCH SCOPE HTTP E2E
// Uses Prisma mock, NOT real MySQL.
// ==========================================

const currentChart = {
  id: 4,
  name: 'Bang so do GROUP',
  unit: 'cm',
  version: 1,
  products: [],
  categories: [{ id: 5 }],
};

const updatedGroupChart = {
  ...currentChart,
  version: 2,
  rows: [
    {
      sizeCode: 'M',
      measurements: { chest: 90 },
    },
  ],
};

const updatedProductChart = {
  ...updatedGroupChart,
  products: [{ id: 6 }],
  categories: [],
};

const tx = createSizeChartPatchTxMock();

const prismaMock = {
  $transaction: jest.fn(),
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

    if (req.headers.authorization === 'Bearer test-admin') {
      req.user = { id: 1, role: UserRole.ADMIN };
      return true;
    }

    throw new UnauthorizedException();
  }
}

@Module({
  controllers: [AdminSizeChartsController],
  providers: catalogAdminProviders(SizeChartsService, prismaMock, idempotencyMock, TestAuthGuard),
})
class PatchScopeTestModule {}

describe('BE-02 M02 - PATCH Scope HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = '/api/v1/admin/size-charts/4';

  const patchAsAdmin = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PatchScopeTestModule],
    }).compile();

    app = await createCatalogTestApp(moduleRef);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.resetAllMocks();

    tx.sizeChart.findUnique
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce(updatedGroupChart);

    tx.sizeChart.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.product.findUnique.mockResolvedValue({
      id: 6,
      sizeChartId: null,
    });

    tx.product.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.category.findUnique.mockResolvedValue({
      id: 5,
      sizeChartId: null,
    });

    tx.category.updateMany.mockResolvedValue({
      count: 1,
    });

    prismaMock.$transaction.mockImplementation(
      async (
        callback: (client: typeof tx) => Promise<unknown>,
      ) => callback(tx),
    );
  });

  // ========================================
  // TEST 1 - CHANGE TYPE WITHOUT ID
  // ========================================

  it('1. Doi GROUP sang PRODUCT thieu scopeId tra 400', async () => {
    await patchAsAdmin({
      version: 1,
      scopeType: 'PRODUCT',
    }).expect(HttpStatus.BAD_REQUEST);

    expect(tx.sizeChart.updateMany).not.toHaveBeenCalled();

    expect(tx.category.updateMany).not.toHaveBeenCalled();

    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 2 - KEEP SAME TYPE
  // ========================================

  it('2. Giu GROUP khong can scopeId - 200', async () => {
    const response = await patchAsAdmin({
      version: 1,
      scopeType: 'GROUP',
    }).expect(HttpStatus.OK);

    expect(response.body.data).toMatchObject({
      id: '4',
      scopeType: 'GROUP',
      scopeId: '5',
      version: 2,
    });

    expect(tx.category.updateMany).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 3 - CHANGE TYPE WITH TARGET ID
  // ========================================

  it('3. Doi GROUP sang PRODUCT co scopeId - 200', async () => {
    tx.sizeChart.findUnique
      .mockReset()
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce(updatedProductChart);

    const response = await patchAsAdmin({
      version: 1,
      scopeType: 'PRODUCT',
      scopeId: '6',
    }).expect(HttpStatus.OK);

    expect(response.body.data).toMatchObject({
      id: '4',
      scopeType: 'PRODUCT',
      scopeId: '6',
      version: 2,
    });

    expect(tx.category.updateMany).toHaveBeenCalledWith({
      where: {
        id: 5,
        sizeChartId: 4,
      },
      data: {
        sizeChartId: null,
      },
    });

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 6,
        sizeChartId: null,
      },
      data: {
        sizeChartId: 4,
      },
    });
  });

  // ========================================
  // TEST 4 - TARGET SCOPE ALREADY OCCUPIED
  // ========================================

  it('4. PRODUCT dich da co bang so do tra 409', async () => {
    tx.product.findUnique.mockResolvedValue({
      id: 6,
      sizeChartId: 99,
    });

    await patchAsAdmin({
      version: 1,
      scopeType: 'PRODUCT',
      scopeId: '6',
    }).expect(HttpStatus.CONFLICT);

    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 5 - TARGET SCOPE NOT FOUND
  // ========================================

  it('5. PRODUCT dich khong ton tai tra 404', async () => {
    tx.product.findUnique.mockResolvedValue(null);

    await patchAsAdmin({
      version: 1,
      scopeType: 'PRODUCT',
      scopeId: '999999',
    }).expect(HttpStatus.NOT_FOUND);

    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });
});
