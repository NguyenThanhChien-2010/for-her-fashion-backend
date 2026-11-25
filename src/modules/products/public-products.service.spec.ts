
import {
  Prisma,
  ProductStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PublicProductsService } from './public-products.service';

describe('BE-02 PublicProductsService', () => {
  const prisma = {
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
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

    prisma.product.findMany.mockResolvedValue([
      makeProduct(),
    ]);

    prisma.product.count.mockResolvedValue(1);

    service = new PublicProductsService(
      prisma as unknown as PrismaService,
    );
  });

  // ==========================================
  // PART 1 - PUBLIC PRODUCT DETAIL
  // ==========================================

  it('DETAIL: lấy sản phẩm ACTIVE thành công', async () => {
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

  it('DETAIL: sản phẩm không tồn tại trả 404', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('999999'),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('DETAIL: chỉ truy vấn sản phẩm ACTIVE', async () => {
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

  it('DETAIL: ID không hợp lệ trả 400', async () => {
    await expect(
      service.findOne('abc'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('DETAIL: ID vượt số nguyên an toàn trả 400', async () => {
    await expect(
      service.findOne('9999999999999999999999'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  // ==========================================
  // PART 2 - PUBLIC PRODUCT LIST CƠ BẢN
  // ==========================================

  it('LIST: mặc định page=1, limit=20, chỉ ACTIVE', async () => {
    const result = await service.findAll({});

    expect(result).toEqual({
      items: [
        {
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
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
      },
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
      },
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ProductStatus.ACTIVE,
        },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('LIST: phân trang page=2, limit=5', async () => {
    await service.findAll({
      page: '2',
      limit: '5',
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
      }),
    );
  });

  it('LIST: tìm kiếm và loại bỏ khoảng trắng thừa', async () => {
    await service.findAll({
      q: ' áo ',
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: ProductStatus.ACTIVE,
        OR: [
          { name: { contains: 'áo' } },
          { slug: { contains: 'áo' } },
          { baseCode: { contains: 'áo' } },
        ],
      }),
    });
  });

  it('LIST: lọc theo categoryId', async () => {
    await service.findAll({
      categoryId: '4',
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        categoryId: 4,
      },
    });
  });

  it('LIST: lọc giá và sắp xếp PRICE_ASC', async () => {
    await service.findAll({
      minPrice: '100000',
      maxPrice: '500000',
      sort: 'PRICE_ASC',
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ProductStatus.ACTIVE,
          price: {
            gte: new Prisma.Decimal(100000),
            lte: new Prisma.Decimal(500000),
          },
        },
        orderBy: [
          { price: Prisma.SortOrder.asc },
          { id: Prisma.SortOrder.desc },
        ],
      }),
    );
  });

  it('LIST: sắp xếp PRICE_DESC', async () => {
    await service.findAll({
      sort: 'PRICE_DESC',
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { price: Prisma.SortOrder.desc },
          { id: Prisma.SortOrder.desc },
        ],
      }),
    );
  });

  it('LIST: minPrice lớn hơn maxPrice trả 400', async () => {
    await expect(
      service.findAll({
        minPrice: '500000',
        maxPrice: '100000',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('LIST: limit lớn hơn 100 trả 400', async () => {
    await expect(
      service.findAll({
        limit: '101',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.count).not.toHaveBeenCalled();
  });

  it('LIST: RELEVANCE chưa triển khai trả 400', async () => {
    await expect(
      service.findAll({
        sort: 'RELEVANCE',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  // ==========================================
  // PART 3 - SKU FILTERS
  // ==========================================

  it('SKU: inStock=true yêu cầu tồn kho lớn hơn 0', async () => {
    await service.findAll({
      inStock: 'true',
    });

    const expectedWhere = {
      status: ProductStatus.ACTIVE,
      variants: {
        some: {
          isActive: true,
          inventory: {
            is: {
              quantity: {
                gt: 0,
              },
            },
          },
        },
      },
    };

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
      }),
    );
  });

  it('SKU: lọc một màu colorIds=1', async () => {
    await service.findAll({
      colorIds: '1',
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            colorId: {
              in: [1],
            },
          },
        },
      },
    });
  });

  it('SKU: nhiều màu có điều kiện OR trong màu', async () => {
    await service.findAll({
      colorIds: ['1', '2'],
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            colorId: {
              in: [1, 2],
            },
          },
        },
      },
    });
  });

  it('SKU: nhiều size có điều kiện OR trong size', async () => {
    await service.findAll({
      sizeCodes: ['M', 'L'],
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            sizeCode: {
              in: ['M', 'L'],
            },
          },
        },
      },
    });
  });

  it('SKU: màu, size, tồn kho phải nằm trong cùng một SKU', async () => {
    await service.findAll({
      colorIds: '1',
      sizeCodes: 'L',
      inStock: 'true',
    });

    const expectedWhere = {
      status: ProductStatus.ACTIVE,
      variants: {
        some: {
          isActive: true,
          colorId: {
            in: [1],
          },
          sizeCode: {
            in: ['L'],
          },
          inventory: {
            is: {
              quantity: {
                gt: 0,
              },
            },
          },
        },
      },
    };

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
      }),
    );

    // Một "some" duy nhất đảm bảo các điều kiện
    // không bị tách sang nhiều ProductVariant.
    const args = prisma.product.findMany.mock.calls[0][0] as {
      where: {
        variants: {
          some: Record<string, unknown>;
        };
      };
    };

    expect(args.where.variants.some).toEqual({
      isActive: true,
      colorId: { in: [1] },
      sizeCode: { in: ['L'] },
      inventory: {
        is: {
          quantity: {
            gt: 0,
          },
        },
      },
    });
  });

  it('SKU: inStock=false không giới hạn tồn kho', async () => {
    await service.findAll({
      colorIds: '1',
      inStock: 'false',
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            colorId: {
              in: [1],
            },
          },
        },
      },
    });
  });

  it('SKU: chỉ inStock=false không thêm bộ lọc SKU', async () => {
    await service.findAll({
      inStock: 'false',
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
      },
    });
  });

  it('SKU: colorIds không hợp lệ trả 400', async () => {
    await expect(
      service.findAll({
        colorIds: 'abc',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('SKU: inStock không hợp lệ trả 400', async () => {
    await expect(
      service.findAll({
        inStock: 'invalid',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.count).not.toHaveBeenCalled();
  });

  it('SKU: sizeCode quá dài trả 400', async () => {
    await expect(
      service.findAll({
        sizeCodes: 'SIZE_CODE_TOO_LONG',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('SKU: loại bỏ màu bị lặp', async () => {
    await service.findAll({
      colorIds: ['1', '1', '2'],
    });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        variants: {
          some: {
            isActive: true,
            colorId: {
              in: [1, 2],
            },
          },
        },
      },
    });
  });
});
