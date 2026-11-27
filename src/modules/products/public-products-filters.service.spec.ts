
import {
  Prisma,
  ProductStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PublicProductsFiltersService } from './public-products-filters.service';

describe('BE-02 PublicProductsFiltersService', () => {
  const prisma = {
    color: {
      findMany: jest.fn(),
    },
    size: {
      findMany: jest.fn(),
    },
    product: {
      aggregate: jest.fn(),
    },
  };

  let service: PublicProductsFiltersService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.color.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'BE02 TEST Đỏ',
        skuSuffix: 'B02RED',
        groupId: 1,
      },
      {
        id: 2,
        name: 'BE02 TEST Xanh',
        skuSuffix: 'B02BLUE',
        groupId: 1,
      },
    ]);

    prisma.size.findMany.mockResolvedValue([
      {
        code: 'M',
        name: 'Medium',
        skuSuffix: 'BE02M',
        sortOrder: 2,
      },
      {
        code: 'L',
        name: 'Large',
        skuSuffix: 'BE02L',
        sortOrder: 3,
      },
    ]);

    prisma.product.aggregate.mockResolvedValue({
      _min: {
        price: new Prisma.Decimal(250000),
      },
      _max: {
        price: new Prisma.Decimal(250000),
      },
    });

    service = new PublicProductsFiltersService(
      prisma as unknown as PrismaService,
    );
  });

  it('FILTERS: trả màu, size và khoảng giá', async () => {
    const result = await service.getFilters();

    expect(result).toEqual({
      colors: [
        {
          id: '1',
          name: 'BE02 TEST Đỏ',
          skuSuffix: 'B02RED',
          groupId: '1',
        },
        {
          id: '2',
          name: 'BE02 TEST Xanh',
          skuSuffix: 'B02BLUE',
          groupId: '1',
        },
      ],
      sizes: [
        {
          code: 'M',
          label: 'Medium',
          skuSuffix: 'BE02M',
        },
        {
          code: 'L',
          label: 'Large',
          skuSuffix: 'BE02L',
        },
      ],
      minPrice: 250000,
      maxPrice: 250000,
    });
  });

  it('FILTERS: chỉ lấy dữ liệu của sản phẩm ACTIVE', async () => {
    await service.getFilters();

    expect(prisma.color.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          variants: {
            some: {
              isActive: true,
              product: {
                is: {
                  status: ProductStatus.ACTIVE,
                },
              },
            },
          },
        },
      }),
    );

    expect(prisma.product.aggregate).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
      },
      _min: { price: true },
      _max: { price: true },
    });
  });

  it('FILTERS: categoryId=4 giới hạn đúng danh mục', async () => {
    await service.getFilters('4');

    expect(prisma.product.aggregate).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        categoryId: 4,
      },
      _min: { price: true },
      _max: { price: true },
    });

    expect(prisma.size.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          variants: {
            some: {
              isActive: true,
              product: {
                is: {
                  status: ProductStatus.ACTIVE,
                  categoryId: 4,
                },
              },
            },
          },
        },
      }),
    );
  });

  it('FILTERS: không có dữ liệu trả mảng rỗng', async () => {
    prisma.color.findMany.mockResolvedValue([]);
    prisma.size.findMany.mockResolvedValue([]);
    prisma.product.aggregate.mockResolvedValue({
      _min: { price: null },
      _max: { price: null },
    });

    const result = await service.getFilters('999999');

    expect(result).toEqual({
      colors: [],
      sizes: [],
    });
  });

  it('FILTERS: categoryId sai định dạng trả 400', async () => {
    await expect(
      service.getFilters('abc'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.color.findMany).not.toHaveBeenCalled();
  });

  it('FILTERS: categoryId=0 trả 400', async () => {
    await expect(
      service.getFilters('0'),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('FILTERS: ID quá lớn trả 400', async () => {
    await expect(
      service.getFilters('99999999999999999999'),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('FILTERS: rejects out-of-range Int before DB', async () => {
    await expect(service.getFilters('2147483648')).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(prisma.color.findMany).not.toHaveBeenCalled();
    expect(prisma.size.findMany).not.toHaveBeenCalled();
    expect(prisma.product.aggregate).not.toHaveBeenCalled();
  });

  it('FILTERS: accepts signed Int upper boundary', async () => {
    await service.getFilters('2147483647');
    expect(prisma.product.aggregate).toHaveBeenCalledWith({
      where: { status: ProductStatus.ACTIVE, categoryId: 2147483647 },
      _min: { price: true },
      _max: { price: true },
    });
  });
});
