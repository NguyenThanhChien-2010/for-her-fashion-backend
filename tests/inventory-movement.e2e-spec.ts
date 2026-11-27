import {
  CanActivate,
  ExecutionContext,
  Injectable,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';

import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
} from '@nestjs/core';

import { Test } from '@nestjs/testing';
import { InventoryReason, Prisma, UserRole } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';

import request from 'supertest';
import type { App } from 'supertest/types';

import { InventoryModule } from '../src/modules/inventory/inventory.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';

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

    const roles = new Map<string, UserRole>([
      ['Bearer test-admin', UserRole.ADMIN],
      ['Bearer test-staff', UserRole.STAFF],
      ['Bearer test-customer', UserRole.CUSTOMER],
    ]);

    const role = roles.get(
      req.headers.authorization ?? '',
    );

    if (!role) {
      throw new UnauthorizedException();
    }

    req.user = {
      id: role === UserRole.ADMIN ? 1 : 2,
      role,
    };

    return true;
  }
}

const createdAt = new Date('2026-11-26T07:00:00.000Z');

const makeMovement = (
  overrides: Record<string, unknown> = {},
) => ({
  id: 10,
  variantId: 1,
  delta: -2,
  reason: InventoryReason.ORDER_CREATED,
  note: 'Web order 1001',
  sourceDocumentId: 'KV-ORDER-1001',
  createdAt,
  operationKey: 'internal-operation-key',
  inventoryVersion: 2,
  createdBy: 1,
  refType: 'ORDER',
  refId: 1001,
  ...overrides,
});

const tx = {
  productVariant: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },

  inventoryMovement: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },

  inventory: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },

  pendingInventoryEffect: {
    groupBy: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },

  inventoryAdjustment: {
    create: jest.fn(),
  },

  $executeRaw: jest.fn(),
};

const prismaMock = {
  ...tx,
  $transaction: jest.fn(),
};

const loggerMock = {
  error: jest.fn(),
};

describe('BE-02 M03 Inventory Movement HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = (id: string) =>
    `/api/v1/admin/inventory/${id}/movements`;

  const getAs = (
    token: string,
    id = '1',
    query: Record<string, string> = {},
  ) =>
    request(app.getHttpServer())
      .get(endpoint(id))
      .set('Authorization', `Bearer ${token}`)
      .query(query);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InventoryModule],

      providers: [
        {
          provide: PinoLogger,
          useValue: loggerMock,
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
          provide: APP_FILTER,
          useClass: AllExceptionsFilter,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: TransformResponseInterceptor,
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');

    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    tx.productVariant.findUnique.mockResolvedValue({
      id: 1,
    });

    tx.inventoryMovement.count.mockResolvedValue(1);

    tx.inventoryMovement.findMany.mockResolvedValue([
      makeMovement(),
    ]);
  });

  // 1. AUTHORIZATION

  it.each([
    'test-admin',
    'test-staff',
  ])(
    'AUTH: %s can access movement history - 200',
    async (token) => {
      const res = await getAs(token)
        .set('X-Request-ID', 'm03-movement-test')
        .expect(200);

      expect(res.body).toEqual({
        data: {
          items: [
            {
              id: '10',
              variantId: '1',
              delta: -2,
              reason: 'ORDER_CREATED: Web order 1001',
              sourceReference: 'KV-ORDER-1001',
              occurredAt: '2026-11-26T07:00:00.000Z',
            },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
          },
        },
        traceId: 'm03-movement-test',
      });

      expect(res.headers['x-request-id'])
        .toBe('m03-movement-test');

      expect(prismaMock.$transaction)
        .toHaveBeenCalledWith(
          expect.any(Function),
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.RepeatableRead,
          },
        );
    },
  );

  it('AUTH: CUSTOMER forbidden - 403', async () => {
    const res = await getAs('test-customer')
      .expect(403);

    expect(res.body).toMatchObject({
      error: {
        code: 'FORBIDDEN',
      },
      traceId: expect.any(String),
    });

    expect(res.body).not.toHaveProperty('data');

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  it('AUTH: missing credential - 401', async () => {
    const res = await request(app.getHttpServer())
      .get(endpoint('1'))
      .expect(401);

    expect(res.body).toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
    });

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  it('AUTH: invalid credential - 401', async () => {
    const res = await getAs('invalid-token')
      .expect(401);

    expect(res.body).toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
    });

    expect(prismaMock.$transaction)
      .not.toHaveBeenCalled();
  });

  // 2. EMPTY AND MISSING VARIANTS

  it('LIST: existing SKU without movements returns empty list', async () => {
    tx.inventoryMovement.count.mockResolvedValue(0);
    tx.inventoryMovement.findMany.mockResolvedValue([]);

    const res = await getAs('test-admin')
      .expect(200);

    expect(res.body.data).toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });
  });

  it('LIST: missing SKU returns 404', async () => {
    tx.productVariant.findUnique.mockResolvedValue(null);

    const res = await getAs('test-admin', '999999')
      .expect(404);

    expect(res.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
      },
      traceId: expect.any(String),
    });

    expect(tx.inventoryMovement.count)
      .not.toHaveBeenCalled();

    expect(tx.inventoryMovement.findMany)
      .not.toHaveBeenCalled();
  });

  // 3. PAGINATION AND SKU ISOLATION

  it('LIST: filters by SKU and requests stable descending order', async () => {
    tx.productVariant.findUnique.mockResolvedValue({
      id: 2,
    });

    tx.inventoryMovement.count.mockResolvedValue(5);

    tx.inventoryMovement.findMany.mockResolvedValue([
      makeMovement({
        id: 8,
        variantId: 2,
        delta: 2,
        reason: InventoryReason.ORDER_CANCELLED,
      }),
      makeMovement({
        id: 7,
        variantId: 2,
      }),
    ]);

    const res = await getAs('test-staff', '2', {
      page: '2',
      limit: '2',
    }).expect(200);

    expect(res.body.data.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 5,
    });

    expect(res.body.data.items).toEqual([
      expect.objectContaining({
        id: '8',
        variantId: '2',
        delta: 2,
      }),
      expect.objectContaining({
        id: '7',
        variantId: '2',
        delta: -2,
      }),
    ]);

    expect(tx.inventoryMovement.count)
      .toHaveBeenCalledWith({
        where: { variantId: 2 },
      });

    expect(tx.inventoryMovement.findMany)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: { variantId: 2 },
          skip: 2,
          take: 2,
          orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
        }),
      );
  });

  it('LIST: page beyond results returns empty items', async () => {
    tx.inventoryMovement.findMany.mockResolvedValue([]);

    const res = await getAs('test-admin', '1', {
      page: '10',
      limit: '2',
    }).expect(200);

    expect(res.body.data).toEqual({
      items: [],
      pagination: {
        page: 10,
        limit: 2,
        total: 1,
      },
    });
  });

  // 4. RESPONSE CONTRACT

  it('MOVEMENT: preserves positive delta and nullable source reference', async () => {
    tx.inventoryMovement.findMany.mockResolvedValue([
      makeMovement({
        delta: 3,
        reason: InventoryReason.RETURN_RECEIVED,
        note: null,
        sourceDocumentId: null,
      }),
    ]);

    const res = await getAs('test-admin')
      .expect(200);

    expect(res.body.data.items).toEqual([
      {
        id: '10',
        variantId: '1',
        delta: 3,
        reason: 'RETURN_RECEIVED',
        sourceReference: null,
        occurredAt: '2026-11-26T07:00:00.000Z',
      },
    ]);
  });

  // 5. VARIANT ID VALIDATION

  it.each([
    'abc',
    '0',
    '-1',
    '01',
    '1.5',
    '2147483648',
  ])(
    'VALIDATION: invalid variantId %s returns 400',
    async (id) => {
      const res = await getAs('test-admin', id)
        .expect(400);

      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: expect.any(Array),
        },
        traceId: expect.any(String),
      });

      expect(prismaMock.$transaction)
        .not.toHaveBeenCalled();
    },
  );

  // 6. QUERY VALIDATION

  it.each([
    'page=0',
    'limit=101',
    'unsupported=true',
    'page=1&page=2',
  ])(
    'VALIDATION: invalid query %s returns 400',
    async (queryString) => {
      const res = await request(app.getHttpServer())
        .get(`${endpoint('1')}?${queryString}`)
        .set('Authorization', 'Bearer test-admin')
        .expect(400);

      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
        },
        traceId: expect.any(String),
      });

      expect(prismaMock.$transaction)
        .not.toHaveBeenCalled();
    },
  );

  // 7. READ-ONLY GUARANTEE

  it('MOVEMENT: repeated reads never mutate inventory', async () => {
    const first = await getAs('test-admin')
      .expect(200);

    const second = await getAs('test-staff')
      .expect(200);

    expect(first.body.data)
      .toEqual(second.body.data);

    expect(prismaMock.$transaction)
      .toHaveBeenCalledTimes(2);

    const writeMocks = [
      tx.productVariant.update,
      tx.inventoryMovement.create,
      tx.inventoryMovement.update,
      tx.inventoryMovement.delete,
      tx.inventory.create,
      tx.inventory.update,
      tx.inventory.updateMany,
      tx.inventory.upsert,
      tx.inventory.delete,
      tx.pendingInventoryEffect.create,
      tx.pendingInventoryEffect.updateMany,
      tx.inventoryAdjustment.create,
      tx.$executeRaw,
    ];

    for (const mock of writeMocks) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  // 8. DATABASE ERROR

  it('ERROR: database failure returns safe response - 500', async () => {
    tx.inventoryMovement.count.mockRejectedValueOnce(
      new Error('Internal movement database error'),
    );

    const res = await getAs('test-admin')
      .expect(500);

    expect(res.body).toMatchObject({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: expect.any(String),
        details: expect.any(Array),
      },
      traceId: expect.any(String),
    });

    expect(JSON.stringify(res.body)).not.toContain(
      'Internal movement database error',
    );

    expect(loggerMock.error)
      .toHaveBeenCalled();
  });
});
