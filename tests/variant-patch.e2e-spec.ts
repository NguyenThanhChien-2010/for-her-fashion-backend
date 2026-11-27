import { createCatalogTestApp } from './helpers/catalog-e2e.helper';


import { CanActivate, ExecutionContext, Injectable, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AdminVariantsController } from '../src/modules/products/admin-variants.controller';
import { VariantPatchService } from '../src/modules/products/variant-patch.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';


@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: { id: number; role: UserRole };
    }>();

    const roles: Record<string, UserRole> = {
      'Bearer test-admin': UserRole.ADMIN,
      'Bearer test-staff': UserRole.STAFF,
      'Bearer test-customer': UserRole.CUSTOMER,
    };

    const role = roles[req.headers.authorization ?? ''];

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

const existingVariant = {
  id: 10,
  productId: 3,
  colorId: 2,
  sizeCode: 'M',
  sku: 'AD10005DOM',
  version: 1,
  isActive: true,
  colorDisplayLabel: null,
  sizeDisplayLabel: null,
};

const updatedVariant = {
  ...existingVariant,
  version: 2,
  isActive: false,
  colorDisplayLabel: 'Do do',
  sizeDisplayLabel: 'Size M',
};

const tx = {
  productVariant: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const prismaMock = {
  $transaction: jest.fn(),
};

describe('BE-02 M02 Variant PATCH HTTP E2E', () => {
  let app: INestApplication<App>;

  const endpoint = '/api/v1/admin/variants/10';

  const patchAs = (
    token: string,
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .patch(endpoint)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminVariantsController],
      providers: [
        VariantPatchService,
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
    }).compile();

    app = await createCatalogTestApp(moduleRef);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();

    tx.productVariant.findUnique.mockResolvedValue(existingVariant);
    tx.productVariant.updateMany.mockResolvedValue({ count: 1 });
    tx.productVariant.findUniqueOrThrow.mockResolvedValue(
      updatedVariant,
    );
    tx.auditLog.create.mockResolvedValue({ id: 1n });

    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
  });

  it('ADMIN updates status - 200', async () => {
    const res = await patchAs('test-admin', {
      version: 1,
      status: 'INACTIVE',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: '10',
      sku: 'AD10005DOM',
      status: 'INACTIVE',
      version: 2,
    });
    expect(res.body.traceId).toEqual(expect.any(String));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('STAFF updates display labels - 200', async () => {
    const res = await patchAs('test-staff', {
      version: 1,
      colorDisplayLabel: 'Do do',
      sizeDisplayLabel: 'Size M',
    });

    expect(res.status).toBe(200);
    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 10, version: 1 },
      data: {
        version: { increment: 1 },
        colorDisplayLabel: 'Do do',
        sizeDisplayLabel: 'Size M',
      },
    });
  });

  it('STAFF cannot change status - 403', async () => {
    const res = await patchAs('test-staff', {
      version: 1,
      status: 'INACTIVE',
    });

    expect(res.status).toBe(403);
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('CUSTOMER cannot access Admin API - 403', async () => {
    const res = await patchAs('test-customer', {
      version: 1,
      status: 'INACTIVE',
    });

    expect(res.status).toBe(403);
  });

  it('missing authentication - 401', async () => {
    const res = await request(app.getHttpServer())
      .patch(endpoint)
      .send({ version: 1, status: 'INACTIVE' });

    expect(res.status).toBe(401);
  });

  it('version-only payload - 400', async () => {
    const res = await patchAs('test-admin', {
      version: 1,
    });

    expect(res.status).toBe(400);
  });

  it('unknown fields cannot change SKU - 400', async () => {
    const res = await patchAs('test-admin', {
      version: 1,
      status: 'INACTIVE',
      sku: 'FORGED-SKU',
    });

    expect(res.status).toBe(400);
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('stale version - 409', async () => {
    const res = await patchAs('test-admin', {
      version: 9,
      status: 'INACTIVE',
    });

    expect(res.status).toBe(409);
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('missing variant - 404', async () => {
    tx.productVariant.findUnique.mockResolvedValueOnce(null);

    const res = await patchAs('test-admin', {
      version: 1,
      status: 'INACTIVE',
    });

    expect(res.status).toBe(404);
  });

  it('version conflict during update - 409', async () => {
    tx.productVariant.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    const res = await patchAs('test-admin', {
      version: 1,
      status: 'INACTIVE',
    });

    expect(res.status).toBe(409);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('invalid version - 400', async () => {
    const res = await patchAs('test-admin', {
      version: 0,
      status: 'INACTIVE',
    });

    expect(res.status).toBe(400);
  });
});