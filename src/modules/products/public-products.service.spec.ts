
import {
  Prisma,
  ProductStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PublicProductsService } from './public-products.service';

describe('BE-02 PublicProductsService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
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

    prisma.$queryRaw.mockReset();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 1n }])
      .mockResolvedValueOnce([{ id: 3 }]);

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

  it('RELEVANCE: khong co tu khoa, tra ket qua va pagination', async () => {
    const result = await service.findAll({
      sort: 'RELEVANCE',
    });

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
    });

    expect(result.items.map((item) => item.id)).toEqual(['3']);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

    const idsSql = prisma.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(idsSql.sql).toContain(
      'CASE WHEN p.id IS NOT NULL THEN 0 ELSE 1 END',
    );
    expect(idsSql.sql).toContain('p.createdAt DESC');
    expect(idsSql.sql).toContain('p.id ASC');
    expect(idsSql.sql).toContain('LIMIT');
    expect(idsSql.sql).toContain('OFFSET');

    expect(prisma.product.count).not.toHaveBeenCalled();
  });

  it('RELEVANCE: tim kiem voi SQL tham so hoa', async () => {
    await service.findAll({
      sort: 'RELEVANCE',
      q: 'áo sơ',
    });

    const countSql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const idsSql = prisma.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(countSql.sql).toContain('LOCATE');
    expect(idsSql.sql).toContain('CASE');
    expect(idsSql.sql).toContain('LOCATE');
    expect(idsSql.sql).toContain('ELSE 2');

    expect(idsSql.values).toContain('áo sơ');
    expect(idsSql.values).toContain('áo');
    expect(idsSql.values).toContain('sơ');

    expect(idsSql.sql).not.toContain('áo sơ');
  });

  it('RELEVANCE: loc mau, size va ton kho tren cung SKU', async () => {
    await service.findAll({
      sort: 'RELEVANCE',
      colorIds: '1',
      sizeCodes: 'M',
      inStock: 'true',
    });

    const countSql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const idsSql = prisma.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(countSql.sql).toContain('EXISTS');
    expect(countSql.sql).toContain('product_variants v');
    expect(countSql.sql).toContain('v.colorId IN');
    expect(countSql.sql).toContain('v.sizeCode IN');
    expect(countSql.sql).toContain('i.quantity > 0');

    expect(countSql.values).toContain(1);
    expect(countSql.values).toContain('M');

    expect(idsSql.sql).toContain('sv.colorId IN');
    expect(idsSql.sql).toContain('sv.sizeCode IN');
    expect(idsSql.sql).toContain('si.quantity > 0');
  });

  it('RELEVANCE: phan trang va giu thu tu tu SQL', async () => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 4n }])
      .mockResolvedValueOnce([{ id: 4 }, { id: 3 }]);

    prisma.product.findMany.mockResolvedValueOnce([
      makeProduct({ id: 3 }),
      makeProduct({ id: 4, name: 'San pham thu hai' }),
    ]);

    const result = await service.findAll({
      sort: 'RELEVANCE',
      page: '2',
      limit: '2',
    });

    expect(result.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 4,
    });

    expect(result.items.map((item) => item.id)).toEqual([
      '4',
      '3',
    ]);

    const idsSql = prisma.$queryRaw.mock.calls[1][0] as Prisma.Sql;

    expect(idsSql.values.slice(-2)).toEqual([2, 2]);
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

  it.each([
    { categoryId: '2147483648' },
    { colorIds: ['2147483648'] },
    { categoryId: '2147483648', sort: 'RELEVANCE' },
    { colorIds: ['2147483648'], sort: 'RELEVANCE' },
  ])('LIST: rejects out-of-range Int before DB (%j)', async (query) => {
    await expect(service.findAll(query)).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(prisma.product.count).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('DETAIL: rejects out-of-range Int before DB', async () => {
    await expect(service.findOne('2147483648')).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('LIST: accepts signed Int upper boundary for both IDs', async () => {
    await service.findAll({
      categoryId: '2147483647',
      colorIds: ['2147483647'],
    });
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        status: ProductStatus.ACTIVE,
        categoryId: 2147483647,
        variants: { some: { isActive: true, colorId: { in: [2147483647] } } },
      },
    });
  });

  it('DETAIL: accepts signed Int upper boundary', async () => {
    await service.findOne('2147483647');
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 2147483647 }),
      }),
    );
  });
});
