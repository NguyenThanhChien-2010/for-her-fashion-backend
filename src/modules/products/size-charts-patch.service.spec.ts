import { PrismaService } from '../prisma/prisma.service';

import { IdempotencyService } from '../../common/services/idempotency.service';

import { SizeChartsService } from './size-charts.service';

import { SizeChartPatchDto } from './dto/size-chart-patch.dto';

// ==========================================
// BE-02 / M02
// PATCH SIZE CHART SERVICE UNIT TEST
//
// Mock Prisma Transaction.
// KHONG truy cap MySQL that.
// ==========================================

describe('BE-02 SizeChartsService - PATCH', () => {
  // ========================================
  // TEST DATA
  // ========================================

  const currentChart = {
    id: 3,
    name: 'Bang so do ao thun',
    unit: 'cm',
    version: 1,
    isActive: true,
    products: [{ id: 3 }],
    categories: [],
  };

  const updatedChart = {
    ...currentChart,
    name: 'Bang so do ao thun cap nhat',
    version: 2,
    rows: [
      {
        sizeCode: 'L',
        measurements: {
          chest: 94,
          waist: 76,
          length: 66,
        },
      },
      {
        sizeCode: 'M',
        measurements: {
          chest: 88,
          waist: 70,
          length: 63,
        },
      },
    ],
  };

  const validRows = [
    {
      sizeCode: 'M',
      measurements: {
        chest: 88,
        waist: 70,
        length: 63,
      },
    },
    {
      sizeCode: 'L',
      measurements: {
        chest: 94,
        waist: 76,
        length: 66,
      },
    },
  ];

  // ========================================
  // MOCK PRISMA TRANSACTION CLIENT
  // ========================================

  const tx = {
    sizeChart: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    sizeChartRow: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    size: {
      findMany: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  // ========================================
  // MOCK PRISMA SERVICE
  // ========================================

  const prisma = {
    $transaction: jest.fn(),
  };

  const idempotency = {
    execute: jest.fn(),
  };

  let service: SizeChartsService;

  // ========================================
  // SETUP
  // ========================================

  beforeEach(() => {
    jest.resetAllMocks();

    tx.sizeChart.findUnique
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce(updatedChart);

    tx.sizeChart.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.sizeChartRow.deleteMany.mockResolvedValue({
      count: 2,
    });

    tx.sizeChartRow.createMany.mockResolvedValue({
      count: 2,
    });

    tx.size.findMany.mockResolvedValue([
      { code: 'M' },
      { code: 'L' },
    ]);

    tx.product.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: null,
    });

    tx.product.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.category.findUnique.mockResolvedValue({
      id: 5,
      sizeChartId: null,
    });

    tx.category.updateMany.mockResolvedValue({
      count: 1,
    });

    prisma.$transaction.mockImplementation(
      async (
        callback: (
          client: typeof tx,
        ) => Promise<unknown>,
      ) => callback(tx),
    );

    service = new SizeChartsService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
    );
  });

  // ========================================
  // TEST 1
  // ========================================

  it('1. PATCH ten thanh cong va tang version', async () => {
    const dto: SizeChartPatchDto = {
      version: 1,
      name: 'Bang so do ao thun cap nhat',
    };

    const result = await service.patch('3', dto);

    expect(result).toMatchObject({
      id: '3',
      name: 'Bang so do ao thun cap nhat',
      scopeType: 'PRODUCT',
      scopeId: '3',
      version: 2,
    });

    expect(tx.sizeChart.updateMany).toHaveBeenCalledWith({
      where: {
        id: 3,
        version: 1,
      },
      data: {
        name: 'Bang so do ao thun cap nhat',
        version: {
          increment: 1,
        },
      },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  // ========================================
  // TEST 2
  // ========================================

  it('2. PATCH rows thay the danh sach so do', async () => {
    const dto: SizeChartPatchDto = {
      version: 1,
      rows: validRows,
    };

    const result = await service.patch('3', dto);

    expect(result.version).toBe(2);
    expect(result.rows).toHaveLength(2);

    expect(tx.size.findMany).toHaveBeenCalledWith({
      where: {
        code: {
          in: ['M', 'L'],
        },
        isActive: true,
      },
      select: {
        code: true,
      },
    });

    expect(
      tx.sizeChartRow.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        chartId: 3,
      },
    });

    expect(
      tx.sizeChartRow.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          chartId: 3,
          sizeCode: 'L',
          measurements: {
            chest: 94,
            length: 66,
            waist: 76,
          },
        },
        {
          chartId: 3,
          sizeCode: 'M',
          measurements: {
            chest: 88,
            length: 63,
            waist: 70,
          },
        },
      ],
    });
  });

  // ========================================
  // TEST 3
  // ========================================

  it('3. Version cu tra HTTP 409', async () => {
    tx.sizeChart.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.patch('3', {
        version: 1,
        name: 'Cap nhat khong hop le',
      }),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.sizeChartRow.deleteMany,
    ).not.toHaveBeenCalled();

    expect(
      tx.category.updateMany,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 4
  // ========================================

  it('4. Bang so do khong ton tai tra HTTP 404', async () => {
    tx.sizeChart.findUnique.mockReset();
    tx.sizeChart.findUnique.mockResolvedValue(null);

    await expect(
      service.patch('999999', {
        version: 1,
        name: 'Bang moi',
      }),
    ).rejects.toMatchObject({
      status: 404,
    });

    expect(
      tx.sizeChart.updateMany,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 5
  // ========================================

  it('5. Chi gui version tra HTTP 400', async () => {
    await expect(
      service.patch('3', {
        version: 1,
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 6
  // ========================================

  it('6. So do am tra HTTP 400', async () => {
    await expect(
      service.patch('3', {
        version: 1,
        rows: [
          {
            sizeCode: 'M',
            measurements: {
              chest: -5,
            },
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 7
  // ========================================

  it('7. Size khong ton tai tra HTTP 400', async () => {
    tx.size.findMany.mockResolvedValue([]);

    await expect(
      service.patch('3', {
        version: 1,
        rows: [
          {
            sizeCode: 'XXL',
            measurements: {
              chest: 110,
              waist: 90,
            },
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(tx.size.findMany).toHaveBeenCalledTimes(1);

    expect(
      tx.sizeChartRow.deleteMany,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 8
  // ========================================

  it('8. Chuyen PRODUCT sang GROUP thanh cong', async () => {
    const finalGroupChart = {
      ...updatedChart,
      products: [],
      categories: [{ id: 5 }],
    };

    tx.sizeChart.findUnique
      .mockReset()
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce(finalGroupChart);

    const result = await service.patch('3', {
      version: 1,
      scopeType: 'GROUP',
      scopeId: '5',
    });

    expect(result).toMatchObject({
      id: '3',
      scopeType: 'GROUP',
      scopeId: '5',
      version: 2,
    });

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 3,
        sizeChartId: 3,
      },
      data: {
        sizeChartId: null,
      },
    });

    expect(tx.category.updateMany).toHaveBeenCalledWith({
      where: {
        id: 5,
        sizeChartId: null,
      },
      data: {
        sizeChartId: 3,
      },
    });
  });

  // ========================================
  // TEST 9
  // ========================================

  it('9. Pham vi dich da co chart tra 409', async () => {
    tx.category.findUnique.mockResolvedValue({
      id: 5,
      sizeChartId: 99,
    });

    await expect(
      service.patch('3', {
        version: 1,
        scopeType: 'GROUP',
        scopeId: '5',
      }),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.category.updateMany,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 10
  // ========================================

  it('10. Hai lan PATCH cung version chi mot lan duoc phep cap nhat', async () => {
    tx.sizeChart.findUnique
      .mockReset()
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce(updatedChart)
      .mockResolvedValueOnce({
        ...currentChart,
        version: 2,
      });

    tx.sizeChart.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await service.patch('3', {
      version: 1,
      name: 'Cap nhat lan dau',
    });

    expect(first.version).toBe(2);

    await expect(
      service.patch('3', {
        version: 1,
        name: 'Cap nhat lan hai',
      }),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.sizeChart.updateMany,
    ).toHaveBeenCalledTimes(2);
  });

  // ========================================
  // TEST 11
  // ========================================

  it('11. chartId khong hop le tra HTTP 400', async () => {
    await expect(
      service.patch('abc', {
        version: 1,
        name: 'Bang moi',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 12
  // ========================================

  it('12. PATCH instructions thanh cong, luu vao Prisma va tra ve response', async () => {
    const instructions = 'Huong dan do kich thuoc';

    // Gia lap database tra ve noi dung instructions sau khi update.
    tx.sizeChart.findUnique
      .mockReset()
      .mockResolvedValueOnce(currentChart)
      .mockResolvedValueOnce({
        ...updatedChart,
        instructions,
      });

    const result = await service.patch('3', {
      version: 1,
      instructions,
    });

    expect(tx.sizeChart.updateMany).toHaveBeenCalledWith({
      where: {
        id: 3,
        version: 1,
      },
      data: {
        instructions,
        version: {
          increment: 1,
        },
      },
    });

    expect(result).toMatchObject({
      id: '3',
      scopeType: 'PRODUCT',
      scopeId: '3',
      instructions,
      version: 2,
    });

    expect(tx.sizeChartRow.deleteMany).not.toHaveBeenCalled();
    expect(tx.sizeChartRow.createMany).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.category.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
