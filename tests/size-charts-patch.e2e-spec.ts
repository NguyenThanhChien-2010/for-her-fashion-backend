
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

import { AdminSizeChartsController } from '../src/modules/products/admin-size-charts.controller';
import { SizeChartsService } from '../src/modules/products/size-charts.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// ==========================================
// BE-02 / M02 - PATCH HTTP E2E
// Prisma Mock - Khong sua MySQL that
// ==========================================

const currentChart = {
  id: 4,
  name: 'Bang so do kiem thu',
  unit: 'cm',
  version: 1,
  isActive: true,
  products: [],
  categories: [{ id: 5 }],
};

const updatedChart = {
  ...currentChart,
  name: 'Bang so do da cap nhat',
  version: 2,
  rows: [
    {
      sizeCode: 'L',
      measurements: {
        chest: 94,
        waist: 76,
      },
    },
    {
      sizeCode: 'M',
      measurements: {
        chest: 90,
        waist: 72,
      },
    },
  ],
};

const tx = {
  sizeChart: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  sizeChartRow: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  size: {
    findMany: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  category: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
};

const prismaMock = {
  $transaction: jest.fn(),
};

const idempotencyMock = {
  execute: jest.fn(),
};

// ==========================================
// TEST AUTH GUARD
// ==========================================

@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: {
        authorization?: string;
      };
      user?: {
        id: number;
        role: UserRole;
      };
    }>();

    switch (req.headers.authorization) {
      case 'Bearer test-admin':
        req.user = {
          id: 1,
          role: UserRole.ADMIN,
        };
        return true;

      case 'Bearer test-staff':
        req.user = {
          id: 2,
          role: UserRole.STAFF,
        };
        return true;

      case 'Bearer test-customer':
        req.user = {
          id: 3,
          role: UserRole.CUSTOMER,
        };
        return true;

      default:
        throw new UnauthorizedException();
    }
  }
}

// ==========================================
// TEST MODULE
// ==========================================

@Module({
  controllers: [AdminSizeChartsController],
  providers: [
    SizeChartsService,
    {
      provide: PrismaService,
      useValue: prismaMock,
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
class SizeChartsPatchE2eModule {}

// ==========================================
// HTTP TESTS
// ==========================================

describe('BE-02 SizeCharts PATCH HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint =
    '/api/v1/admin/size-charts/4';

  const patchAs = (
    role: string,
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .patch(endpoint)
      .set('Authorization', `Bearer ${role}`)
      .send(body);

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [SizeChartsPatchE2eModule],
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
    jest.resetAllMocks();

    tx.sizeChart.findUnique
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce(updatedChart);

    tx.sizeChart.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.sizeChartRow.deleteMany.mockResolvedValue({
      count: 2,
    });

    tx.sizeChartRow.createMany.mockResolvedValue({
      count: 2,
    });

    tx.size.findMany.mockResolvedValue([
      { code: 'M' },
      { code: 'L' },
    ]);

    tx.category.findUnique.mockResolvedValue({
      id: 5,
      sizeChartId: null,
    });

    tx.category.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.product.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: null,
    });

    tx.product.updateMany.mockResolvedValue({
      count: 1,
    });

    prismaMock.$transaction.mockImplementation(
      async (
        callback: (
          client: typeof tx,
        ) => Promise<unknown>,
      ) => callback(tx),
    );
  });

  // ========================================
  // 1. ADMIN PATCH
  // ========================================

  it('1. ADMIN cap nhat ten thanh cong - 200', async () => {
    const response = await patchAs('test-admin', {
      version: 1,
      name: 'Bang so do da cap nhat',
    }).expect(HttpStatus.OK);

    expect(response.body.data).toMatchObject({
      id: '4',
      name: 'Bang so do da cap nhat',
      scopeType: 'GROUP',
      scopeId: '5',
      version: 2,
    });

    expect(
      tx.sizeChart.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 4,
        version: 1,
      },
      data: {
        name: 'Bang so do da cap nhat',
        version: {
          increment: 1,
        },
      },
    });
  });

  // ========================================
  // 2. STAFF PATCH
  // ========================================

  it('2. STAFF duoc cap nhat - 200', async () => {
    const response = await patchAs('test-staff', {
      version: 1,
      name: 'Bang so do da cap nhat',
    }).expect(HttpStatus.OK);

    expect(response.body.data.version).toBe(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  // ========================================
  // 3. NO JWT
  // ========================================

  it('3. Khong JWT tra HTTP 401', async () => {
    await request(app.getHttpServer())
      .patch(endpoint)
      .send({
        version: 1,
        name: 'Test',
      })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // 4. CUSTOMER
  // ========================================

  it('4. CUSTOMER khong co quyen - 403', async () => {
    await patchAs('test-customer', {
      version: 1,
      name: 'Test',
    }).expect(HttpStatus.FORBIDDEN);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // 5. MISSING VERSION
  // ========================================

  it('5. Thieu version tra HTTP 400', async () => {
    await patchAs('test-admin', {
      name: 'Bang so do moi',
    }).expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // 6. VERSION ONLY
  // ========================================

  it('6. Chi co version tra HTTP 400', async () => {
    await patchAs('test-admin', {
      version: 1,
    }).expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // 7. EXTRA PROPERTY
  // ========================================

  it('7. Truong thua trong body tra 400', async () => {
    await patchAs('test-admin', {
      version: 1,
      name: 'Bang moi',
      unknownField: 'khong duoc phep',
    }).expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // 8. STALE VERSION
  // ========================================

  it('8. Version cu tra HTTP 409', async () => {
    tx.sizeChart.updateMany.mockResolvedValue({
      count: 0,
    });

    await patchAs('test-admin', {
      version: 1,
      name: 'Bang moi',
    }).expect(HttpStatus.CONFLICT);

    expect(
      tx.sizeChartRow.deleteMany,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // 9. CHART NOT FOUND
  // ========================================

  it('9. Bang khong ton tai tra HTTP 404', async () => {
    tx.sizeChart.findUnique.mockReset();
    tx.sizeChart.findUnique.mockResolvedValue(null);

    await patchAs('test-admin', {
      version: 1,
      name: 'Bang moi',
    }).expect(HttpStatus.NOT_FOUND);

    expect(
      tx.sizeChart.updateMany,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // 10. REPLACE ROWS
  // ========================================

  it('10. PATCH rows thay danh sach so do - 200', async () => {
    const response = await patchAs('test-admin', {
      version: 1,
      rows: [
        {
          sizeCode: 'M',
          measurements: {
            chest: 90,
            waist: 72,
          },
        },
        {
          sizeCode: 'L',
          measurements: {
            chest: 94,
            waist: 76,
          },
        },
      ],
    }).expect(HttpStatus.OK);

    expect(response.body.data.rows).toHaveLength(2);

    expect(
      tx.sizeChartRow.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        chartId: 4,
      },
    });

    expect(
      tx.sizeChartRow.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          chartId: 4,
          sizeCode: 'L',
          measurements: {
            chest: 94,
            waist: 76,
          },
        },
        {
          chartId: 4,
          sizeCode: 'M',
          measurements: {
            chest: 90,
            waist: 72,
          },
        },
      ],
    });
  });

  // ========================================
  // 11. INVALID ROWS
  // ========================================

  it('11. Rows rong tra HTTP 400', async () => {
    await patchAs('test-admin', {
      version: 1,
      rows: [],
    }).expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // 12. INVALID CHART ID
  // ========================================

  it('12. chartId khong hop le tra HTTP 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/size-charts/abc')
      .set('Authorization', 'Bearer test-admin')
      .send({
        version: 1,
        name: 'Bang moi',
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // 13. PATCH INSTRUCTIONS
  // ========================================

  it('13. PATCH instructions thanh cong va tra HTTP 200', async () => {
    const instructions = 'Huong dan lay so do';

    // Gia lap Prisma doc lai bang sau khi transaction cap nhat.
    tx.sizeChart.findUnique
      .mockReset()
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce({
        ...updatedChart,
        instructions,
      });

    const response = await patchAs('test-admin', {
      version: 1,
      instructions,
    }).expect(HttpStatus.OK);

    expect(response.body.data).toMatchObject({
      id: '4',
      scopeType: 'GROUP',
      scopeId: '5',
      instructions,
      version: 2,
    });

    expect(tx.sizeChart.updateMany).toHaveBeenCalledWith({
      where: {
        id: 4,
        version: 1,
      },
      data: {
        instructions,
        version: {
          increment: 1,
        },
      },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.sizeChartRow.deleteMany).not.toHaveBeenCalled();
    expect(tx.sizeChartRow.createMany).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.category.updateMany).not.toHaveBeenCalled();
  });

  // ========================================
  // 14. INVALID SIZE
  // ========================================

  it('14. Size khong ton tai tra HTTP 400', async () => {
    tx.size.findMany.mockResolvedValue([]);

    await patchAs('test-admin', {
      version: 1,
      rows: [
        {
          sizeCode: 'XXL',
          measurements: {
            chest: 110,
          },
        },
      ],
    }).expect(HttpStatus.BAD_REQUEST);

    expect(
      tx.sizeChartRow.deleteMany,
    ).not.toHaveBeenCalled();
  });
});
