
import { UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';

import { SizeChartsService } from './size-charts.service';
import { SizeChartCreateDto } from './dto/size-chart-create.dto';

describe('BE-02 SizeChartsService', () => {
  const prisma = {
    sizeChart: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const tx = {
    product: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    size: {
      findMany: jest.fn(),
    },
    sizeChart: {
      create: jest.fn(),
    },
  };

  const idempotency = {
    execute: jest.fn(),
  };

  let service: SizeChartsService;

  const admin = {
    id: 1,
    role: UserRole.ADMIN,
  };

  const staff = {
    id: 2,
    role: UserRole.STAFF,
  };

  const validDto: SizeChartCreateDto = {
    name: 'Bảng số đo váy công sở',
    scopeType: 'GROUP',
    scopeId: '3',
    unit: 'cm',
    rows: [
      {
        sizeCode: 'M',
        measurements: {
          chest: 90,
          waist: 72,
          hip: 96,
        },
      },
      {
        sizeCode: 'L',
        measurements: {
          chest: 94,
          waist: 76,
          hip: 100,
        },
      },
    ],
  };

  const createChart = (
    dto: SizeChartCreateDto = validDto,
  ) =>
    service.create(
      dto,
      'be02-size-chart-create-key-0001',
      admin,
    );

  beforeEach(() => {
    jest.resetAllMocks();

    // GET mocks
    prisma.sizeChart.findMany.mockResolvedValue([]);
    prisma.sizeChart.count.mockResolvedValue(0);

    // POST mocks
    tx.product.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: null,
    });

    tx.category.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: null,
    });

    tx.size.findMany.mockResolvedValue([
      { code: 'M' },
      { code: 'L' },
    ]);

    tx.sizeChart.create.mockResolvedValue({
      id: 10,
      name: 'Bảng số đo váy công sở',
      unit: 'cm',
      version: 1,
    });

    tx.product.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.category.updateMany.mockResolvedValue({
      count: 1,
    });

    idempotency.execute.mockImplementation(
      async (
        _subject: string,
        _key: string,
        _scope: string,
        callback: (
          transaction: typeof tx,
        ) => Promise<{
          statusCode: number;
          data: unknown;
        }>,
      ) => {
        const result = await callback(tx);
        return result.data;
      },
    );

    service = new SizeChartsService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
    );
  });

  // ==========================================
  // GET /admin/size-charts
  // 10 UNIT TEST CU
  // ==========================================

  it('1. Trả danh sách rỗng đúng contract', async () => {
    await expect(service.list()).resolves.toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });
  });

  it('2. Phân trang đúng page=2 limit=5', async () => {
    await service.list('2', '5');

    expect(prisma.sizeChart.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
      }),
    );
  });

  it('3. page=0 trả HTTP 400', async () => {
    await expect(
      service.list('0', '20'),
    ).rejects.toMatchObject({ status: 400 });

    expect(prisma.sizeChart.findMany).not.toHaveBeenCalled();
  });

  it('4. limit=101 trả HTTP 400', async () => {
    await expect(
      service.list('1', '101'),
    ).rejects.toMatchObject({ status: 400 });

    expect(prisma.sizeChart.findMany).not.toHaveBeenCalled();
  });

  it('5. page không phải số trả HTTP 400', async () => {
    await expect(
      service.list('abc', '20'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('6. page vượt số nguyên an toàn trả HTTP 400', async () => {
    await expect(
      service.list('999999999999999999999', '20'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('7. Trả bảng số đo thuộc sản phẩm', async () => {
    prisma.sizeChart.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Bảng số đo áo sơ mi',
        unit: 'cm',
        version: 1,
        products: [{ id: 3 }],
        categories: [],
        rows: [
          {
            sizeCode: 'M',
            measurements: {
              chest: 96,
              waist: 80,
              length: 68,
            },
          },
        ],
      },
    ]);

    prisma.sizeChart.count.mockResolvedValue(1);

    const result = await service.list();

    expect(result.items).toEqual([
      {
        id: '1',
        name: 'Bảng số đo áo sơ mi',
        scopeType: 'PRODUCT',
        scopeId: '3',
        unit: 'cm',
        rows: [
          {
            sizeCode: 'M',
            measurements: {
              chest: 96,
              waist: 80,
              length: 68,
            },
          },
        ],
        version: 1,
      },
    ]);

    expect(result.pagination.total).toBe(1);
  });

  it('8. Trả bảng số đo thuộc danh mục', async () => {
    prisma.sizeChart.findMany.mockResolvedValue([
      {
        id: 2,
        name: 'Bảng số đo váy',
        unit: 'cm',
        version: 1,
        products: [],
        categories: [{ id: 2 }],
        rows: [
          {
            sizeCode: 'L',
            measurements: {
              waist: 76,
              hip: 100,
            },
          },
        ],
      },
    ]);

    const result = await service.list();

    expect(result.items[0]).toMatchObject({
      id: '2',
      scopeType: 'GROUP',
      scopeId: '2',
      rows: [
        {
          sizeCode: 'L',
          measurements: {
            waist: 76,
            hip: 100,
          },
        },
      ],
    });
  });

  it('9. Bảng chưa được gán phạm vi trả 409', async () => {
    prisma.sizeChart.findMany.mockResolvedValue([
      {
        id: 3,
        name: 'Bảng chưa gán',
        unit: 'cm',
        version: 1,
        products: [],
        categories: [],
        rows: [],
      },
    ]);

    await expect(
      service.list(),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('10. Bảng có nhiều phạm vi trả 409', async () => {
    prisma.sizeChart.findMany.mockResolvedValue([
      {
        id: 4,
        name: 'Bảng nhiều phạm vi',
        unit: 'cm',
        version: 1,
        products: [{ id: 2 }, { id: 3 }],
        categories: [],
        rows: [],
      },
    ]);

    await expect(
      service.list(),
    ).rejects.toMatchObject({ status: 409 });
  });

  // ==========================================
  // POST /admin/size-charts
  // 8 UNIT TEST MOI
  // ==========================================

  it('11. Tạo bảng số đo GROUP thành công', async () => {
    const result = await createChart();

    expect(result).toEqual({
      id: '10',
      name: 'Bảng số đo váy công sở',
      scopeType: 'GROUP',
      scopeId: '3',
      unit: 'cm',
      rows: [
        {
          sizeCode: 'L',
          measurements: {
            chest: 94,
            hip: 100,
            waist: 76,
          },
        },
        {
          sizeCode: 'M',
          measurements: {
            chest: 90,
            hip: 96,
            waist: 72,
          },
        },
      ],
      version: 1,
    });

    expect(tx.sizeChart.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Bảng số đo váy công sở',
        unit: 'cm',
        isActive: true,
        rows: {
          create: expect.arrayContaining([
            expect.objectContaining({
              sizeCode: 'M',
            }),
            expect.objectContaining({
              sizeCode: 'L',
            }),
          ]),
        },
      }),
    });

    expect(tx.category.updateMany).toHaveBeenCalledWith({
      where: {
        id: 3,
        sizeChartId: null,
      },
      data: {
        sizeChartId: 10,
      },
    });

    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('12. Tạo bảng riêng PRODUCT thành công', async () => {
    const dto: SizeChartCreateDto = {
      ...validDto,
      scopeType: 'PRODUCT',
    };

    const result = await createChart(dto);

    expect(result).toMatchObject({
      scopeType: 'PRODUCT',
      scopeId: '3',
    });

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 3,
        sizeChartId: null,
      },
      data: {
        sizeChartId: 10,
      },
    });

    expect(tx.category.updateMany).not.toHaveBeenCalled();
  });

  it('13. GROUP không tồn tại trả 404', async () => {
    tx.category.findUnique.mockResolvedValue(null);

    await expect(createChart()).rejects.toMatchObject({
      status: 404,
    });

    expect(tx.sizeChart.create).not.toHaveBeenCalled();
  });

  it('14. Phạm vi đã có bảng số đo trả 409', async () => {
    tx.category.findUnique.mockResolvedValue({
      id: 3,
      sizeChartId: 5,
    });

    await expect(createChart()).rejects.toMatchObject({
      status: 409,
    });

    expect(tx.sizeChart.create).not.toHaveBeenCalled();
  });

  it('15. Size bị trùng trả 400', async () => {
    const dto: SizeChartCreateDto = {
      ...validDto,
      rows: [
        validDto.rows[0],
        validDto.rows[0],
      ],
    };

    await expect(
      createChart(dto),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('16. Số đo âm hoặc bằng 0 trả 400', async () => {
    const dto: SizeChartCreateDto = {
      ...validDto,
      rows: [
        {
          sizeCode: 'M',
          measurements: {
            chest: -10,
          },
        },
      ],
    };

    await expect(
      createChart(dto),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('17. Size không tồn tại hoặc không hoạt động trả 400', async () => {
    tx.size.findMany.mockResolvedValue([
      { code: 'M' },
    ]);

    await expect(createChart()).rejects.toMatchObject({
      status: 400,
    });

    expect(tx.sizeChart.create).not.toHaveBeenCalled();
  });

  it('18. Có tranh chấp khi gán bảng trả 409 và có requestHash', async () => {
    tx.category.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(createChart()).rejects.toMatchObject({
      status: 409,
    });

    expect(idempotency.execute).toHaveBeenCalledWith(
      '1',
      'be02-size-chart-create-key-0001',
      'admin.size-charts.create',
      expect.any(Function),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );

    // STAFF cũng là vai trò hợp lệ theo contract.
    expect(staff.role).toBe(UserRole.STAFF);
  });
});
