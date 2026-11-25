
import { PrismaService } from '../prisma/prisma.service';

import { IdempotencyService } from '../../common/services/idempotency.service';

import { SizeChartsService } from './size-charts.service';

// ==========================================
// BE-02 / M02
// GET ADMIN SIZE CHART DETAIL UNIT TEST
// ==========================================

describe('BE-02 SizeChartsService - GET Detail', () => {
  // ========================================
  // MOCK PRISMA
  // ========================================

  const prisma = {
    sizeChart: {
      findUnique: jest.fn(),
    },
  };

  const idempotency = {
    execute: jest.fn(),
  };

  let service: SizeChartsService;

  // ========================================
  // MOCK CHART PRODUCT
  // ========================================

  const productChart = {
    id: 3,
    name: 'Bảng số đo riêng áo thun nữ - PRODUCT',
    unit: 'cm',
    version: 1,
    isActive: true,

    products: [{ id: 3 }],
    categories: [],

    rows: [
      {
        id: 5,
        chartId: 3,
        sizeCode: 'L',
        measurements: {
          chest: 94,
          waist: 76,
          length: 66,
        },
      },
      {
        id: 6,
        chartId: 3,
        sizeCode: 'M',
        measurements: {
          chest: 88,
          waist: 70,
          length: 63,
        },
      },
    ],
  };

  // ========================================
  // MOCK CHART GROUP
  // ========================================

  const groupChart = {
    id: 2,
    name: 'Bảng số đo áo sơ mi - GROUP',
    unit: 'cm',
    version: 1,
    isActive: true,

    products: [],
    categories: [{ id: 4 }],

    rows: [
      {
        id: 3,
        chartId: 2,
        sizeCode: 'L',
        measurements: {
          chest: 100,
          waist: 84,
          length: 68,
        },
      },
      {
        id: 4,
        chartId: 2,
        sizeCode: 'M',
        measurements: {
          chest: 94,
          waist: 78,
          length: 65,
        },
      },
    ],
  };

  // ========================================
  // BEFORE EACH
  // ========================================

  beforeEach(() => {
    jest.resetAllMocks();

    prisma.sizeChart.findUnique.mockResolvedValue(
      productChart,
    );

    service = new SizeChartsService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
    );
  });

  // ========================================
  // TEST 1 - PRODUCT DETAIL
  // ========================================

  it('1. Lấy chi tiết bảng PRODUCT thành công', async () => {
    const result = await service.getById('3');

    expect(result).toEqual({
      id: '3',
      name: 'Bảng số đo riêng áo thun nữ - PRODUCT',
      scopeType: 'PRODUCT',
      scopeId: '3',
      unit: 'cm',
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
      version: 1,
    });

    expect(
      prisma.sizeChart.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        id: 3,
      },
      include: {
        rows: {
          orderBy: {
            sizeCode: 'asc',
          },
        },
        products: {
          select: {
            id: true,
          },
        },
        categories: {
          select: {
            id: true,
          },
        },
      },
    });
  });

  // ========================================
  // TEST 2 - GROUP DETAIL
  // ========================================

  it('2. Lấy chi tiết bảng GROUP thành công', async () => {
    prisma.sizeChart.findUnique.mockResolvedValue(
      groupChart,
    );

    const result = await service.getById('2');

    expect(result).toMatchObject({
      id: '2',
      name: 'Bảng số đo áo sơ mi - GROUP',
      scopeType: 'GROUP',
      scopeId: '4',
      unit: 'cm',
      version: 1,
    });

    expect(result.rows).toHaveLength(2);

    expect(result.rows[0]).toMatchObject({
      sizeCode: 'L',
      measurements: {
        chest: 100,
        waist: 84,
        length: 68,
      },
    });
  });

  // ========================================
  // TEST 3 - INVALID ID
  // ========================================

  it('3. chartId không hợp lệ trả HTTP 400', async () => {
    await expect(
      service.getById('abc'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      prisma.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 4 - ZERO ID
  // ========================================

  it('4. chartId bằng 0 trả HTTP 400', async () => {
    await expect(
      service.getById('0'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      prisma.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 5 - UNSAFE INTEGER
  // ========================================

  it('5. chartId vượt số nguyên an toàn trả HTTP 400', async () => {
    await expect(
      service.getById('999999999999999999999'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      prisma.sizeChart.findUnique,
    ).not.toHaveBeenCalled();
  });

  // ========================================
  // TEST 6 - NOT FOUND
  // ========================================

  it('6. Bảng số đo không tồn tại trả HTTP 404', async () => {
    prisma.sizeChart.findUnique.mockResolvedValue(null);

    await expect(
      service.getById('999999'),
    ).rejects.toMatchObject({
      status: 404,
    });

    expect(
      prisma.sizeChart.findUnique,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 999999,
        },
      }),
    );
  });

  // ========================================
  // TEST 7 - MISSING SCOPE
  // ========================================

  it('7. Bảng không có phạm vi trả HTTP 409', async () => {
    prisma.sizeChart.findUnique.mockResolvedValue({
      ...productChart,
      products: [],
      categories: [],
    });

    await expect(
      service.getById('3'),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  // ========================================
  // TEST 8 - MULTIPLE PRODUCT SCOPES
  // ========================================

  it('8. Bảng gắn nhiều sản phẩm trả HTTP 409', async () => {
    prisma.sizeChart.findUnique.mockResolvedValue({
      ...productChart,
      products: [
        { id: 3 },
        { id: 4 },
      ],
      categories: [],
    });

    await expect(
      service.getById('3'),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  // ========================================
  // TEST 9 - CONFLICTING SCOPE TYPES
  // ========================================

  it('9. Bảng vừa thuộc PRODUCT vừa thuộc GROUP trả HTTP 409', async () => {
    prisma.sizeChart.findUnique.mockResolvedValue({
      ...productChart,
      products: [{ id: 3 }],
      categories: [{ id: 4 }],
    });

    await expect(
      service.getById('3'),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  // ========================================
  // TEST 10 - INACTIVE CHART
  // ========================================

  it('10. ADMIN vẫn có thể xem bảng đã ngừng hoạt động', async () => {
    prisma.sizeChart.findUnique.mockResolvedValue({
      ...productChart,
      isActive: false,
    });

    const result = await service.getById('3');

    expect(result).toMatchObject({
      id: '3',
      scopeType: 'PRODUCT',
      scopeId: '3',
    });
  });
});
