
import { Prisma, ProductStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PublicProductsService } from './public-products.service';

describe('BE-02 PublicProductsService', () => {
  const prisma = {
    product: {
      findFirst: jest.fn(),
    },
  };

  let service: PublicProductsService;

  const makeProduct = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 3,
    name: 'Áo sơ mi công khai',
    slug: 'ao-so-mi-cong-khai',
    baseCode: 'ASM-PUBLIC-003',
    categoryId: 4,
    description: 'Sản phẩm đang bán',
    price: new Prisma.Decimal(350000),
    status: ProductStatus.ACTIVE,
    version: 1,
    images: [
      {
        id: 10,
        fileId: 25,
        sortOrder: 0,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.product.findFirst.mockResolvedValue(
      makeProduct(),
    );

    service = new PublicProductsService(
      prisma as unknown as PrismaService,
    );
  });

  it('PUBLIC lấy chi tiết ACTIVE thành công', async () => {
    const result = await service.findOne('3');

    expect(result).toEqual({
      id: '3',
      name: 'Áo sơ mi công khai',
      slug: 'ao-so-mi-cong-khai',
      baseCode: 'ASM-PUBLIC-003',
      categoryId: '4',
      description: 'Sản phẩm đang bán',
      price: 350000,
      status: ProductStatus.ACTIVE,
      imageFileIds: ['25'],
      version: 1,
    });

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: 3,
        status: ProductStatus.ACTIVE,
      },
      include: {
        images: {
          orderBy: [
            { sortOrder: Prisma.SortOrder.asc },
            { id: Prisma.SortOrder.asc },
          ],
        },
      },
    });
  });

  it('PUBLIC không tìm thấy sản phẩm trả 404', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('999999'),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('PUBLIC chỉ truy vấn sản phẩm ACTIVE', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('2'),
    ).rejects.toMatchObject({
      status: 404,
    });

    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 2,
          status: ProductStatus.ACTIVE,
        },
      }),
    );
  });

  it('PUBLIC ID không hợp lệ trả 400', async () => {
    await expect(
      service.findOne('abc'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      prisma.product.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('PUBLIC ID vượt giới hạn số nguyên an toàn trả 400', async () => {
    await expect(
      service.findOne('9999999999999999999999'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      prisma.product.findFirst,
    ).not.toHaveBeenCalled();
  });
});
