import { UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { VariantPatchService } from './variant-patch.service';
import type { ProductRequester } from './products.service';

describe('VariantPatchService', () => {
  const admin: ProductRequester = {
    id: 1,
    role: UserRole.ADMIN,
  };

  const staff: ProductRequester = {
    id: 2,
    role: UserRole.STAFF,
  };

  function setup() {
    const before = {
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

    const updated = {
      ...before,
      version: 2,
      isActive: false,
      colorDisplayLabel: 'Do do',
      sizeDisplayLabel: 'Size M',
    };

    const tx = {
      productVariant: {
        findUnique: jest.fn().mockResolvedValue(before),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    const service = new VariantPatchService(
      prisma as unknown as PrismaService,
    );

    return { service, prisma, tx, before, updated };
  }

  it('ADMIN can update variant status', async () => {
    const { service, tx } = setup();

    const result = await service.update(
      '10',
      { version: 1, status: 'INACTIVE' },
      admin,
    );

    expect(result).toEqual({
      id: '10',
      productId: '3',
      colorId: '2',
      sizeCode: 'M',
      sku: 'AD10005DOM',
      status: 'INACTIVE',
      version: 2,
    });

    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 10, version: 1 },
      data: {
        version: { increment: 1 },
        isActive: false,
      },
    });

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('STAFF can update display labels', async () => {
    const { service, tx } = setup();

    await service.update(
      '10',
      {
        version: 1,
        colorDisplayLabel: 'Do do',
        sizeDisplayLabel: 'Size M',
      },
      staff,
    );

    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 10, version: 1 },
      data: {
        version: { increment: 1 },
        colorDisplayLabel: 'Do do',
        sizeDisplayLabel: 'Size M',
      },
    });
  });

  it('STAFF cannot modify variant status', async () => {
    const { service, prisma } = setup();

    await expect(
      service.update(
        '10',
        { version: 1, status: 'INACTIVE' },
        staff,
      ),
    ).rejects.toMatchObject({ status: 403 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects version-only request', async () => {
    const { service } = setup();

    await expect(
      service.update('10', { version: 1 }, admin),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 404 when variant does not exist', async () => {
    const { service, tx } = setup();

    tx.productVariant.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.update(
        '10',
        { version: 1, status: 'INACTIVE' },
        admin,
      ),
    ).rejects.toMatchObject({ status: 404 });

    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('rejects stale version before updating', async () => {
    const { service, tx } = setup();

    await expect(
      service.update(
        '10',
        { version: 2, status: 'INACTIVE' },
        admin,
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('rejects concurrent version conflict', async () => {
    const { service, tx } = setup();

    tx.productVariant.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.update(
        '10',
        { version: 1, status: 'INACTIVE' },
        admin,
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not update SKU, colorId or sizeCode', async () => {
    const { service, tx } = setup();

    await service.update(
      '10',
      {
        version: 1,
        colorDisplayLabel: 'Do do',
      },
      admin,
    );

    const call = tx.productVariant.updateMany.mock.calls[0][0];
    const data = call.data as Record<string, unknown>;

    expect(data).not.toHaveProperty('sku');
    expect(data).not.toHaveProperty('colorId');
    expect(data).not.toHaveProperty('sizeCode');
  });

  it('rejects invalid variant ID', async () => {
    const { service } = setup();

    await expect(
      service.update(
        'abc',
        { version: 1, status: 'INACTIVE' },
        admin,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});