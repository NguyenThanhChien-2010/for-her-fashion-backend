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
import { SyncState, UserRole } from '@prisma/client';
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
      headers: { authorization?: string };
      user?: { id: number; role: UserRole };
    }>();

    const accounts = {
      'Bearer test-admin': {
        id: 1,
        role: UserRole.ADMIN,
      },
      'Bearer test-staff': {
        id: 2,
        role: UserRole.STAFF,
      },
      'Bearer test-customer': {
        id: 3,
        role: UserRole.CUSTOMER,
      },
    };

    const account =
      accounts[
        req.headers.authorization as keyof typeof accounts
      ];

    if (!account) {
      throw new UnauthorizedException();
    }

    req.user = account;
    return true;
  }
}

const body = {
  variantId: '1',
  version: 3,
  countedQuantity: 8,
  reason: 'Local inventory adjustment test',
};

const key = 'M03-ADJUST-E2E-001';

const makeAdjustment = (
  overrides: Record<string, unknown> = {},
) => ({
  id: 10,
  variantId: 1,
  actorId: 1,
  expectedVersion: 3,
  requestedQuantity: 8,
  reason: body.reason,
  status: SyncState.PENDING,
  sourceDocumentId: null,
  ...overrides,
});

const expected = {
  id: '10',
  variantId: '1',
  countedQuantity: 8,
  reason: body.reason,
  status: SyncState.PENDING,
  sourceReference: null,
  version: 3,
};

const tx = {
  inventoryAdjustment: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  productVariant: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  inventory: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  inventoryMovement: {
    create: jest.fn(),
  },
  pendingInventoryEffect: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
};

const prismaMock = {
  ...tx,
  $transaction: jest.fn(),
};

describe('BE-02 M03 Inventory Adjustment HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = '/api/v1/admin/inventory-adjustments';

  const postAs = (
    token: string,
    payload: object = body,
    idempotencyKey = key,
  ) =>
    request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

  const getAs = (
    token: string,
    id = '10',
  ) =>
    request(app.getHttpServer())
      .get(`${endpoint}/${id}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InventoryModule],
      providers: [
        {
          provide: PinoLogger,
          useValue: { error: jest.fn() },
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

    tx.inventoryAdjustment.findUnique
      .mockResolvedValue(null);

    tx.inventoryAdjustment.create
      .mockResolvedValue(makeAdjustment());

    tx.productVariant.findUnique.mockResolvedValue({
      id: 1,
      kiotvietVariantId: 'KV-SKU-001',
    });

    tx.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray) =>
        Promise.resolve(
          strings.join(' ').includes('product_variants')
            ? [{ id: 1 }]
            : [{ version: 3 }],
        ),
    );
  });

  afterEach(() => {
    const forbiddenWrites = [
      tx.inventoryAdjustment.update,
      tx.productVariant.update,
      tx.inventory.create,
      tx.inventory.update,
      tx.inventory.updateMany,
      tx.inventoryMovement.create,
      tx.pendingInventoryEffect.create,
      tx.pendingInventoryEffect.updateMany,
      tx.$executeRaw,
    ];

    for (const mock of forbiddenWrites) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  // 01-02. Create with ADMIN and STAFF.

  it.each([
    ['test-admin', 1],
    ['test-staff', 2],
  ] as const)('POST: %s receives 202', async (token, actorId) => {
    const res = await postAs(token).expect(202);

    expect(res.body).toEqual({
      data: expected,
      traceId: expect.any(String),
    });

    expect(res.headers['x-request-id'])
      .toBe(res.body.traceId);

    expect(tx.inventoryAdjustment.create)
      .toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId,
          variantId: 1,
          requestedQuantity: 8,
          expectedVersion: 3,
          status: SyncState.PENDING,
        }),
      });
  });

  // 03-04. Read with ADMIN and STAFF.

  it.each([
    'test-admin',
    'test-staff',
  ])('GET: %s receives 200', async token => {
    tx.inventoryAdjustment.findUnique
      .mockResolvedValue(makeAdjustment());

    const res = await getAs(token).expect(200);

    expect(res.body.data).toEqual(expected);
  });

  // 05-10. Authentication and authorization.

  it.each([
    ['test-customer', 403, 'FORBIDDEN'],
    ['invalid-token', 401, 'UNAUTHORIZED'],
  ] as const)('POST: rejects %s', async (token, status, code) => {
    const res = await postAs(token).expect(status);

    expect(res.body.error.code).toBe(code);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['test-customer', 403, 'FORBIDDEN'],
    ['invalid-token', 401, 'UNAUTHORIZED'],
  ] as const)('GET: rejects %s', async (token, status, code) => {
    const res = await getAs(token).expect(status);

    expect(res.body.error.code).toBe(code);

    expect(tx.inventoryAdjustment.findUnique)
      .not.toHaveBeenCalled();
  });

  it('POST: missing JWT returns 401', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(401);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('GET: missing JWT returns 401', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/10`)
      .expect(401);
  });

  // 11-14. Request validation.

  it('POST: missing Idempotency-Key returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .send(body)
      .expect(400);

    expect(res.body.error.code)
      .toBe('VALIDATION_ERROR');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('POST: short Idempotency-Key returns 400', async () => {
    await postAs('test-admin', body, 'short').expect(400);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { ...body, countedQuantity: -1 },
    { ...body, actorId: 99 },
  ])('POST: rejects invalid payload %j', async payload => {
    const res = await postAs(
      'test-admin',
      payload,
    ).expect(400);

    expect(res.body.error.code)
      .toBe('VALIDATION_ERROR');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // 15-18. Inventory business conditions.

  it('POST: stale version returns 409', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ version: 4 }]);

    const res = await postAs('test-admin').expect(409);

    expect(res.body.error.code)
      .toBe('VERSION_CONFLICT');

    expect(tx.inventoryAdjustment.create)
      .not.toHaveBeenCalled();
  });

  it('POST: missing SKU returns 404', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);

    const res = await postAs('test-admin').expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(tx.inventoryAdjustment.create).not.toHaveBeenCalled();
  });

  it('POST: missing source link returns 422', async () => {
    tx.productVariant.findUnique.mockResolvedValue({
      id: 1,
      kiotvietVariantId: null,
    });

    const res = await postAs('test-admin').expect(422);

    expect(res.body.error.code)
      .toBe('BUSINESS_RULE_VIOLATION');

    expect(tx.inventoryAdjustment.create).not.toHaveBeenCalled();
  });

  it('POST: missing inventory returns 422', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([]);

    await postAs('test-admin').expect(422);

    expect(tx.inventoryAdjustment.create).not.toHaveBeenCalled();
  });

  // 19-20. Idempotency.

  it('POST: same key and payload returns existing adjustment', async () => {
    tx.inventoryAdjustment.findUnique
      .mockResolvedValue(makeAdjustment());

    const res = await postAs('test-admin').expect(202);

    expect(res.body.data).toEqual(expected);
    expect(tx.inventoryAdjustment.create).not.toHaveBeenCalled();
  });

  it('POST: reused key with different payload returns 409', async () => {
    tx.inventoryAdjustment.findUnique.mockResolvedValue(
      makeAdjustment({ requestedQuantity: 99 }),
    );

    const res = await postAs('test-admin').expect(409);

    expect(res.body.error.code)
      .toBe('IDEMPOTENCY_KEY_REUSED');

    expect(tx.inventoryAdjustment.create).not.toHaveBeenCalled();
  });

  // 21-22. Get adjustment validation.

  it('GET: invalid adjustmentId returns 400', async () => {
    await getAs('test-admin', 'abc').expect(400);

    expect(tx.inventoryAdjustment.findUnique)
      .not.toHaveBeenCalled();
  });

  it('GET: missing adjustment returns 404', async () => {
    const res = await getAs('test-admin').expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // 23. Safe error response.

  it('ERROR: database failure returns safe 500', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      new Error('Internal database detail'),
    );

    const res = await postAs('test-admin').expect(500);

    expect(res.body.error.code)
      .toBe('INTERNAL_SERVER_ERROR');

    expect(JSON.stringify(res.body))
      .not.toContain('Internal database detail');
  });
});
