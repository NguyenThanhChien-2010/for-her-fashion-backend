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
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AdminSizeChartsController } from '../src/modules/products/admin-size-charts.controller';
import { SizeChartsService } from '../src/modules/products/size-charts.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// BE-02 / M02 - DELETE HTTP E2E
// Prisma is mocked: no connection to the real MySQL database.

const chart = {
  id: 8,
  version: 4,
  products: [] as { id: number }[],
  categories: [] as { id: number }[],
};

const tx = {
  $queryRaw: jest.fn(),
  sizeChart: {
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  },
};

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
  controllers: [AdminSizeChartsController],
  providers: [
    SizeChartsService,
    { provide: PrismaService, useValue: prismaMock },
    { provide: IdempotencyService, useValue: idempotencyMock },
    { provide: APP_GUARD, useClass: TestAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformResponseInterceptor,
    },
  ],
})
class SizeChartsDeleteE2eModule {}

describe('BE-02 SizeCharts DELETE HTTP E2E', () => {
  let app: INestApplication<App>;
  const endpoint = '/api/v1/admin/size-charts/8';

  const deleteAs = (
    role: string,
    ifMatch: string | null = '"4"',
    path = endpoint,
  ) => {
    const http = request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${role}`);

    return ifMatch === null ? http : http.set('If-Match', ifMatch);
  };

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [SizeChartsDeleteE2eModule],
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
    tx.$queryRaw.mockResolvedValue([{ id: 8 }]);
    tx.sizeChart.findUnique.mockResolvedValue({
      ...chart,
      products: [],
      categories: [],
    });
    tx.sizeChart.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
  });

  it('1. ADMIN xoa bang khong lien ket: HTTP 204, body rong', async () => {
    const response = await deleteAs('test-admin').expect(HttpStatus.NO_CONTENT);
    expect(response.text).toBe('');
    expect(response.body).toEqual({});
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.sizeChart.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.sizeChart.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.sizeChart.deleteMany.mock.invocationCallOrder[0],
    );
    expect(tx.sizeChart.findUnique).toHaveBeenCalledWith({
      where: { id: 8 },
      select: {
        id: true,
        version: true,
        products: { select: { id: true } },
        categories: { select: { id: true } },
      },
    });
    expect(tx.sizeChart.deleteMany).toHaveBeenCalledWith({
      where: { id: 8, version: 4 },
    });
  });

  it('2. STAFF duoc phep DELETE: HTTP 204', async () => {
    await deleteAs('test-staff').expect(HttpStatus.NO_CONTENT);
    expect(tx.sizeChart.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('3. Khong JWT: HTTP 401', async () => {
    await request(app.getHttpServer())
      .delete(endpoint)
      .set('If-Match', '"4"')
      .expect(HttpStatus.UNAUTHORIZED);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('4. CUSTOMER khong duoc DELETE: HTTP 403', async () => {
    await deleteAs('test-customer').expect(HttpStatus.FORBIDDEN);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('5. Thieu header If-Match: HTTP 400', async () => {
    await deleteAs('test-admin', null).expect(HttpStatus.BAD_REQUEST);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(['4', 'W/"4"', '*', '"0"', '"01"', '"abc"', '"-1"'])(
    '6. If-Match sai dinh dang (%s): HTTP 400',
    async (ifMatch) => {
      await deleteAs('test-admin', ifMatch).expect(HttpStatus.BAD_REQUEST);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it('7. If-Match vuot gioi han Int32: HTTP 400', async () => {
    await deleteAs('test-admin', '"2147483648"').expect(
      HttpStatus.BAD_REQUEST,
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '1.5', '2147483648'])(
    '8. chartId khong hop le (%s): HTTP 400',
    async (chartId) => {
      await deleteAs(
        'test-admin',
        '"4"',
        `/api/v1/admin/size-charts/${chartId}`,
      ).expect(HttpStatus.BAD_REQUEST);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it('9. Chart khong ton tai: HTTP 404', async () => {
    tx.sizeChart.findUnique.mockResolvedValue(null);
    await deleteAs('test-admin').expect(HttpStatus.NOT_FOUND);
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('9b. Khong tim thay chart khi khoa: HTTP 404, khong doc tiep', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    const response = await deleteAs('test-admin').expect(HttpStatus.NOT_FOUND);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(tx.sizeChart.findUnique).not.toHaveBeenCalled();
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('9c. Loi khoa SQL: HTTP 500 va khong DELETE', async () => {
    tx.$queryRaw.mockRejectedValue(new Error('Simulated SQL lock failure'));
    await deleteAs('test-admin').expect(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(tx.sizeChart.findUnique).not.toHaveBeenCalled();
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('10. Version stale: HTTP 409 va khong xoa', async () => {
    const response = await deleteAs('test-admin', '"3"').expect(
      HttpStatus.CONFLICT,
    );
    expect(response.body.code).toBe('VERSION_CONFLICT');
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('11. Con lien ket PRODUCT: HTTP 409 va khong xoa', async () => {
    tx.sizeChart.findUnique.mockResolvedValue({
      ...chart,
      products: [{ id: 4 }],
    });
    const response = await deleteAs('test-admin').expect(
      HttpStatus.CONFLICT,
    );
    expect(response.body.code).toBe('CONFLICT');
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('12. Con lien ket GROUP: HTTP 409 va khong xoa', async () => {
    tx.sizeChart.findUnique.mockResolvedValue({
      ...chart,
      categories: [{ id: 5 }],
    });
    const response = await deleteAs('test-admin').expect(
      HttpStatus.CONFLICT,
    );
    expect(response.body.code).toBe('CONFLICT');
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('13. deleteMany count=0 (concurrent update): HTTP 409', async () => {
    tx.sizeChart.deleteMany.mockResolvedValue({ count: 0 });
    const response = await deleteAs('test-admin').expect(
      HttpStatus.CONFLICT,
    );
    expect(response.body.code).toBe('VERSION_CONFLICT');
  });

  it('14. Prisma P2003 (foreign key): HTTP 409', async () => {
    tx.sizeChart.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint', {
        code: 'P2003',
        clientVersion: '6.19.3',
      }),
    );
    const response = await deleteAs('test-admin').expect(
      HttpStatus.CONFLICT,
    );
    expect(response.body.code).toBe('CONFLICT');
  });

  it('15. Prisma P2034 (concurrent transaction): HTTP 409', async () => {
    tx.sizeChart.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Transaction conflict', {
        code: 'P2034',
        clientVersion: '6.19.3',
      }),
    );
    const response = await deleteAs('test-admin').expect(
      HttpStatus.CONFLICT,
    );
    expect(response.body.code).toBe('CONFLICT');
  });

  it('16. Loi DB khac duoc propagate: HTTP 500', async () => {
    tx.sizeChart.deleteMany.mockRejectedValue(new Error('Database failed'));
    await deleteAs('test-admin').expect(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
