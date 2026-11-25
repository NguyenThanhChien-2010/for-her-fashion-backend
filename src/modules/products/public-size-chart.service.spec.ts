
import { PrismaService } from '../prisma/prisma.service';

import {
  PublicSizeChartService,
} from './public-size-chart.service';

describe('BE-02 PublicSizeChartService', () => {
  const prisma = {
    product: {
      findFirst: jest.fn(),
    },
  };

  let service: PublicSizeChartService;

  // ==========================================
  // DỮ LIỆU MOCK
  // ==========================================

  const groupChart = {
    id: 1,
    name: 'Bảng số đo váy công sở',
    unit: 'cm',
    version: 1,
    isActive: true,
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

  const productChart = {
    id: 2,
    name: 'Bảng số đo riêng sản phẩm',
    unit: 'cm',
    version: 1,
    isActive: true,
    rows: [
      {
        sizeCode: 'M',
        measurements: {
          chest: 88,
          waist: 70,
          hip: 94,
        },
      },
      {
        sizeCode: 'L',
        measurements: {
          chest: 92,
          waist: 74,
          hip: 98,
        },
      },
    ],
  };

  const makeProduct = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 3,
    categoryId: 3,
    variants: [
      { sizeCode: 'M' },
      { sizeCode: 'L' },
    ],
    sizeChartDefinition: null,
    category: {
      sizeChartDefinition: groupChart,
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();

    service = new PublicSizeChartService(
      prisma as unknown as PrismaService,
    );

    prisma.product.findFirst.mockResolvedValue(
      makeProduct(),
    );
  });

  // ==========================================
  // TEST 1 - GROUP FALLBACK
  // ==========================================

  it('1. Không có bảng PRODUCT thì dùng GROUP', async () => {
    const result = await service.getForProduct('3');

    expect(result).toMatchObject({
      id: '1',
      name: 'Bảng số đo váy công sở',
      scopeType: 'GROUP',
      scopeId: '3',
      version: 1,
    });

    expect(result.rows).toHaveLength(2);
  });

  // ==========================================
  // TEST 2 - PRODUCT PRIORITY
  // ==========================================

  it('2. Có cả PRODUCT và GROUP thì ưu tiên PRODUCT', async () => {
    prisma.product.findFirst.mockResolvedValue(
      makeProduct({
        sizeChartDefinition: productChart,
      }),
    );

    const result = await service.getForProduct('3');

    expect(result).toMatchObject({
      id: '2',
      name: 'Bảng số đo riêng sản phẩm',
      scopeType: 'PRODUCT',
      scopeId: '3',
    });

    expect(result.rows[0].measurements).toMatchObject({
      chest: 88,
      waist: 70,
      hip: 94,
    });
  });

  // ==========================================
  // TEST 3 - FILTER ACTUAL SIZES
  // ==========================================

  it('3. Chỉ trả những size thực có của sản phẩm', async () => {
    prisma.product.findFirst.mockResolvedValue(
      makeProduct({
        variants: [{ sizeCode: 'M' }],
      }),
    );

    const result = await service.getForProduct('3');

    expect(result.rows).toHaveLength(1);

    expect(result.rows[0].sizeCode).toBe('M');
  });

  // ==========================================
  // TEST 4 - INACTIVE PRODUCT CHART
  // ==========================================

  it('4. Bảng PRODUCT không hoạt động thì dùng GROUP', async () => {
    prisma.product.findFirst.mockResolvedValue(
      makeProduct({
        sizeChartDefinition: {
          ...productChart,
          isActive: false,
        },
      }),
    );

    const result = await service.getForProduct('3');

    expect(result.scopeType).toBe('GROUP');
    expect(result.id).toBe('1');
  });

  // ==========================================
  // TEST 5 - PRODUCT CHART WITHOUT MATCHING SIZE
  // ==========================================

  it('5. PRODUCT không có size phù hợp thì dùng GROUP', async () => {
    prisma.product.findFirst.mockResolvedValue(
      makeProduct({
        sizeChartDefinition: {
          ...productChart,
          rows: [
            {
              sizeCode: 'XL',
              measurements: {
                chest: 105,
              },
            },
          ],
        },
      }),
    );

    const result = await service.getForProduct('3');

    expect(result.scopeType).toBe('GROUP');
    expect(result.id).toBe('1');
  });

  // ==========================================
  // TEST 6 - NO AVAILABLE CHART
  // ==========================================

  it('6. Không có bảng phù hợp trả 404 SIZE_CHART_NOT_AVAILABLE', async () => {
    prisma.product.findFirst.mockResolvedValue(
      makeProduct({
        sizeChartDefinition: null,
        category: {
          sizeChartDefinition: null,
        },
      }),
    );

    await expect(
      service.getForProduct('3'),
    ).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({
        code: 'SIZE_CHART_NOT_AVAILABLE',
      }),
    });
  });

  // ==========================================
  // TEST 7 - INVALID ID
  // ==========================================

  it('7. Product ID không hợp lệ trả 400', async () => {
    await expect(
      service.getForProduct('abc'),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      prisma.product.findFirst,
    ).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST 8 - PRODUCT NOT FOUND
  // ==========================================

  it('8. Sản phẩm không tồn tại trả 404', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.getForProduct('999'),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
