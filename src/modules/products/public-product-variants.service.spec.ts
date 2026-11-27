import { ProductStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PublicProductVariantsService } from './public-product-variants.service';

describe('PublicProductVariantsService', () => {
  const variant = {
    id: 1,
    productId: 3,
    colorId: 1,
    sizeCode: 'M',
    sku: 'BE02-TEST-P3-RED-M',
    isActive: true,
    version: 2,
  };

  function setup() {
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 }),
      },
      productVariant: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([variant]),
      },
    };

    const service = new PublicProductVariantsService(
      prisma as unknown as PrismaService,
    );

    return { service, prisma };
  }

  it('returns public variants with default pagination', async () => {
    const { service } = setup();

    const result = await service.findAll('3', {});

    expect(result).toEqual({
      items: [
        {
          id: '1',
          productId: '3',
          colorId: '1',
          sizeCode: 'M',
          sku: 'BE02-TEST-P3-RED-M',
          status: 'ACTIVE',
          version: 2,
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
      },
    });
  });

  it('only queries ACTIVE products', async () => {
    const { service, prisma } = setup();

    await service.findAll('3', {});

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: 3,
        status: ProductStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });
  });

  it('only queries ACTIVE variants', async () => {
    const { service, prisma } = setup();

    expect(await service.findAll('3', {})).toBeDefined();

    expect(prisma.productVariant.count).toHaveBeenCalledWith({
      where: {
        productId: 3,
        isActive: true,
      },
    });

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: 3,
          isActive: true,
        },
      }),
    );
  });

  it('filters variants by colorId', async () => {
    const { service, prisma } = setup();

    await service.findAll('3', {
      colorId: '1',
    });

    expect(prisma.productVariant.count).toHaveBeenCalledWith({
      where: {
        productId: 3,
        isActive: true,
        colorId: 1,
      },
    });
  });

  it('filters variants by sizeCode', async () => {
    const { service, prisma } = setup();

    await service.findAll('3', {
      sizeCode: 'M',
    });

    expect(prisma.productVariant.count).toHaveBeenCalledWith({
      where: {
        productId: 3,
        isActive: true,
        sizeCode: 'M',
      },
    });
  });

  it('combines color and size on the same variant', async () => {
    const { service, prisma } = setup();

    await service.findAll('3', {
      colorId: '1',
      sizeCode: 'M',
    });

    const where = {
      productId: 3,
      isActive: true,
      colorId: 1,
      sizeCode: 'M',
    };

    expect(prisma.productVariant.count).toHaveBeenCalledWith({
      where,
    });

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
  });

  it('supports pagination and stable ordering', async () => {
    const { service, prisma } = setup();

    prisma.productVariant.count.mockResolvedValueOnce(10);

    const result = await service.findAll('3', {
      page: '2',
      limit: '3',
    });

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 3,
        take: 3,
        orderBy: {
          id: 'asc',
        },
      }),
    );

    expect(result.pagination).toEqual({
      page: 2,
      limit: 3,
      total: 10,
    });
  });

  it('returns an empty list when no variants match', async () => {
    const { service, prisma } = setup();

    prisma.productVariant.count.mockResolvedValueOnce(0);
    prisma.productVariant.findMany.mockResolvedValueOnce([]);

    const result = await service.findAll('3', {
      sizeCode: 'XXL',
    });

    expect(result).toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });
  });

  it('returns 404 for missing or hidden product', async () => {
    const { service, prisma } = setup();

    prisma.product.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.findAll('3', {}),
    ).rejects.toMatchObject({
      status: 404,
    });

    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '1.5'])(
    'rejects invalid productId: %s',
    async (productId) => {
      const { service } = setup();

      await expect(
        service.findAll(productId, {}),
      ).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it('rejects invalid colorId', async () => {
    const { service } = setup();

    await expect(
      service.findAll('3', {
        colorId: 'abc',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects invalid sizeCode', async () => {
    const { service } = setup();

    await expect(
      service.findAll('3', {
        sizeCode: '',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects invalid page', async () => {
    const { service } = setup();

    await expect(
      service.findAll('3', {
        page: '0',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects limit above 100', async () => {
    const { service } = setup();

    await expect(
      service.findAll('3', {
        limit: '101',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('accepts maximum limit of 100', async () => {
    const { service } = setup();

    const result = await service.findAll('3', {
      limit: '100',
    });

    expect(result.pagination.limit).toBe(100);
  });

  it('rejects unsafe integer IDs', async () => {
    const { service } = setup();

    await expect(
      service.findAll('9007199254740992', {}),
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});