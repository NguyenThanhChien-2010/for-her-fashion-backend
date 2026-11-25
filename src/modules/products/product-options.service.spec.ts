
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ProductOptionsService } from './product-options.service';

describe('BE-02 ProductOptionsService', () => {
  const prisma = {
    color: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    size: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  let service: ProductOptionsService;

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

    prisma.color.count.mockResolvedValue(2);

    prisma.size.findMany.mockResolvedValue([
      {
        code: 'M',
        name: 'Medium',
        skuSuffix: 'BE02M',
      },
      {
        code: 'L',
        name: 'Large',
        skuSuffix: 'BE02L',
      },
    ]);

    prisma.size.count.mockResolvedValue(2);

    service = new ProductOptionsService(
      prisma as unknown as PrismaService,
    );
  });

  it('COLORS: trả danh sách màu đúng contract', async () => {
    const result = await service.listColors();

    expect(result).toEqual({
      items: [
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
      pagination: {
        page: 1,
        limit: 20,
        total: 2,
      },
    });
  });

  it('COLORS: truy vấn phân trang và sắp xếp đúng', async () => {
    await service.listColors('2', '5');

    expect(prisma.color.findMany).toHaveBeenCalledWith({
      where: {},
      skip: 5,
      take: 5,
      orderBy: [
        { name: Prisma.SortOrder.asc },
        { id: Prisma.SortOrder.asc },
      ],
      select: {
        id: true,
        name: true,
        skuSuffix: true,
        groupId: true,
      },
    });

    expect(prisma.color.count).toHaveBeenCalledWith({
      where: {},
    });
  });

  it('COLORS: page=0 trả 400', async () => {
    await expect(
      service.listColors('0', '20'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.color.findMany).not.toHaveBeenCalled();
  });

  it('COLORS: page không phải số trả 400', async () => {
    await expect(
      service.listColors('abc', '20'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.color.count).not.toHaveBeenCalled();
  });

  it('COLORS: limit=101 trả 400', async () => {
    await expect(
      service.listColors('1', '101'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.color.findMany).not.toHaveBeenCalled();
  });

  it('SIZES: trả danh sách size đúng contract', async () => {
    const result = await service.listSizes();

    expect(result).toEqual({
      items: [
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
      pagination: {
        page: 1,
        limit: 20,
        total: 2,
      },
    });
  });

  it('SIZES: truy vấn phân trang và sắp xếp đúng', async () => {
    await service.listSizes('2', '5');

    expect(prisma.size.findMany).toHaveBeenCalledWith({
      where: {},
      skip: 5,
      take: 5,
      orderBy: [
        { sortOrder: Prisma.SortOrder.asc },
        { code: Prisma.SortOrder.asc },
      ],
      select: {
        code: true,
        name: true,
        skuSuffix: true,
      },
    });

    expect(prisma.size.count).toHaveBeenCalledWith({
      where: {},
    });
  });

  it('SIZES: limit=101 trả 400', async () => {
    await expect(
      service.listSizes('1', '101'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.size.findMany).not.toHaveBeenCalled();
  });

  it('SIZES: page vượt số nguyên an toàn trả 400', async () => {
    await expect(
      service.listSizes('999999999999999999999', '20'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.size.count).not.toHaveBeenCalled();
  });
});
