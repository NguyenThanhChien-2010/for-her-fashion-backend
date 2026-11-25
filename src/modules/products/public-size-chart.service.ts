import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ProductStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

@Injectable()
export class PublicSizeChartService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // GET /api/v1/products/:productId/size-chart
  // ==========================================

  async getForProduct(rawProductId: string) {
    // ========================================
    // 1. KIỂM TRA PRODUCT ID
    // ========================================

    if (!/^[1-9][0-9]*$/.test(rawProductId)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID sản phẩm không hợp lệ.',
        ),
      );
    }

    const productId = Number(rawProductId);

    if (!Number.isSafeInteger(productId)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID sản phẩm vượt phạm vi hỗ trợ.',
        ),
      );
    }

    // ========================================
    // 2. CÁC TRƯỜNG CẦN LẤY TỪ SIZE CHART
    // ========================================

    const chartSelect = {
      id: true,
      name: true,
      unit: true,
      instructions: true,
      version: true,
      isActive: true,

      rows: {
        select: {
          sizeCode: true,
          measurements: true,
        },
        orderBy: {
          sizeCode: 'asc' as const,
        },
      },
    } as const;

    // ========================================
    // 3. LẤY SẢN PHẨM VÀ BẢNG SỐ ĐO
    // ========================================

    const product =
      await this.prisma.product.findFirst({
        where: {
          id: productId,
          status: ProductStatus.ACTIVE,
        },

        select: {
          id: true,
          categoryId: true,

          // Các size sản phẩm thực sự có
          variants: {
            where: {
              isActive: true,
            },
            select: {
              sizeCode: true,
            },
          },

          // Bảng số đo riêng của sản phẩm
          sizeChartDefinition: {
            select: chartSelect,
          },

          // Bảng số đo chung của danh mục
          category: {
            select: {
              sizeChartDefinition: {
                select: chartSelect,
              },
            },
          },
        },
      });

    // ========================================
    // 4. KIỂM TRA SẢN PHẨM
    // ========================================

    if (!product) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Sản phẩm không tồn tại hoặc chưa được hiển thị.',
        ),
      );
    }

    // ========================================
    // 5. LẤY CÁC SIZE THỰC CÓ
    // ========================================

    const actualSizes = new Set(
      product.variants.map(
        (variant) => variant.sizeCode,
      ),
    );

    // ========================================
    // 6. THỨ TỰ ƯU TIÊN
    //
    // PRODUCT -> GROUP
    // ========================================

    const candidates = [
      {
        chart: product.sizeChartDefinition,
        scopeType: 'PRODUCT',
        scopeId: product.id,
      },
      {
        chart:
          product.category.sizeChartDefinition,
        scopeType: 'GROUP',
        scopeId: product.categoryId,
      },
    ];

    // ========================================
    // 7. CHỌN BẢNG SỐ ĐO PHÙ HỢP
    // ========================================

    for (const candidate of candidates) {
      const chart = candidate.chart;

      if (!chart || !chart.isActive) {
        continue;
      }

      // Chỉ giữ những size sản phẩm có
      const rows = chart.rows
        .filter((row) =>
          actualSizes.has(row.sizeCode),
        )
        .map((row) => ({
          sizeCode: row.sizeCode,
          measurements: row.measurements,
        }));

      // Bảng riêng không có size phù hợp
      // thì tiếp tục xét bảng của danh mục.
      if (rows.length === 0) {
        continue;
      }

      // ======================================
      // 8. RESPONSE THEO OPENAPI
      // ======================================

      return {
        id: String(chart.id),
        name: chart.name,

        scopeType: candidate.scopeType,
        scopeId: String(candidate.scopeId),

        unit: chart.unit,
        ...(chart.instructions != null
          ? { instructions: chart.instructions }
          : {}),
        rows,
        version: chart.version,
      };
    }

    // ========================================
    // 9. KHÔNG CÓ BẢNG SỐ ĐO PHÙ HỢP
    // ========================================

    throw new NotFoundException({
      code: 'SIZE_CHART_NOT_AVAILABLE',
      message:
        'Không có bảng số đo phù hợp với các size thực có của sản phẩm.',
      details: [],
    });
  }
}
