
import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { IdempotencyService } from '../../common/services/idempotency.service';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import {
  SizeChartCreateDto,
  SizeChartRowDto,
} from './dto/size-chart-create.dto';

import { SizeChartPatchDto } from './dto/size-chart-patch.dto';

import type { ProductRequester } from './products.service';

type ScopeType = 'PRODUCT' | 'GROUP';

interface ChartResponseSource {
  id: number;
  name: string;
  unit: string;
  instructions?: string | null;
  version: number;
  products: { id: number }[];
  categories: { id: number }[];
  rows: {
    sizeCode: string;
    measurements: Prisma.JsonValue;
  }[];
}

@Injectable()
export class SizeChartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ==========================================
  // ERROR HELPERS
  // ==========================================

  private badRequest(message: string): BadRequestException {
    return new BadRequestException(
      apiErrorPayload(
        ErrorCode.VALIDATION_ERROR,
        message,
      ),
    );
  }

  private conflict(message: string): ConflictException {
    return new ConflictException(
      apiErrorPayload(
        ErrorCode.CONFLICT,
        message,
      ),
    );
  }

  private notFound(message: string): NotFoundException {
    return new NotFoundException(
      apiErrorPayload(
        ErrorCode.NOT_FOUND,
        message,
      ),
    );
  }

  // ==========================================
  // ID / INTEGER VALIDATION
  // ==========================================

  private parseNumber(
    value: string | undefined,
    field: string,
    fallback: number,
  ): number {
    if (value === undefined) {
      return fallback;
    }

    if (!/^[1-9][0-9]*$/.test(value)) {
      throw this.badRequest(
        `${field} phải là số nguyên dương.`,
      );
    }

    const result = Number(value);

    if (
      !Number.isSafeInteger(result) ||
      ((field === 'chartId' || field === 'scopeId') && result > 2147483647)
    ) {
      throw this.badRequest(
        `${field} vượt phạm vi hỗ trợ.`,
      );
    }

    return result;
  }

  // ==========================================
  // RESPONSE HELPER
  // ==========================================

  private toResponse(chart: ChartResponseSource) {
    const productCount = chart.products.length;
    const categoryCount = chart.categories.length;

    if (productCount + categoryCount !== 1) {
      throw this.conflict(
        `Bảng số đo ${chart.id} chưa có phạm vi duy nhất.`,
      );
    }

    const isProduct = productCount === 1;

    return {
      id: String(chart.id),
      name: chart.name,
      scopeType: isProduct ? 'PRODUCT' : 'GROUP',
      scopeId: String(
        isProduct
          ? chart.products[0].id
          : chart.categories[0].id,
      ),
      unit: chart.unit,
      ...(chart.instructions != null
        ? { instructions: chart.instructions }
        : {}),
      rows: chart.rows.map((row) => ({
        sizeCode: row.sizeCode,
        measurements: row.measurements,
      })),
      version: chart.version,
    };
  }

  // ==========================================
  // GET /api/v1/admin/size-charts
  // ==========================================

  async list(rawPage?: string, rawLimit?: string) {
    const page = this.parseNumber(rawPage, 'page', 1);
    const limit = this.parseNumber(rawLimit, 'limit', 20);

    if (limit > 100) {
      throw this.badRequest(
        'limit không được lớn hơn 100.',
      );
    }

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      throw this.badRequest(
        'page vượt phạm vi hỗ trợ.',
      );
    }

    const [charts, total] = await Promise.all([
      this.prisma.sizeChart.findMany({
        skip,
        take: limit,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'asc' },
        ],
        include: {
          rows: {
            orderBy: { sizeCode: 'asc' },
          },
          products: {
            select: { id: true },
          },
          categories: {
            select: { id: true },
          },
        },
      }),
      this.prisma.sizeChart.count(),
    ]);

    return {
      items: charts.map((chart) =>
        this.toResponse(chart),
      ),
      pagination: {
        page,
        limit,
        total,
      },
    };
  }

  // ==========================================
  // GET /api/v1/admin/size-charts/:chartId
  // ==========================================

  async getById(rawChartId: string) {
    const chartId = this.parseNumber(
      rawChartId,
      'chartId',
      0,
    );

    const chart = await this.prisma.sizeChart.findUnique({
      where: { id: chartId },
      include: {
        rows: {
          orderBy: { sizeCode: 'asc' },
        },
        products: {
          select: { id: true },
        },
        categories: {
          select: { id: true },
        },
      },
    });

    if (!chart) {
      throw this.notFound(
        'Bảng số đo không tồn tại.',
      );
    }

    return this.toResponse(chart);
  }

  // ==========================================
  // VALIDATE MEASUREMENT ROWS
  // ==========================================

  private validateRows(rows: SizeChartRowDto[]): void {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw this.badRequest(
        'Cần ít nhất một dòng số đo.',
      );
    }

    const seen = new Set<string>();

    for (const row of rows) {
      if (
        typeof row.sizeCode !== 'string' ||
        row.sizeCode.length === 0 ||
        row.sizeCode.length > 10
      ) {
        throw this.badRequest(
          'Mã size không hợp lệ.',
        );
      }

      if (seen.has(row.sizeCode)) {
        throw this.badRequest(
          `Size ${row.sizeCode} bị trùng.`,
        );
      }

      seen.add(row.sizeCode);

      const measurements = row.measurements;

      if (
        typeof measurements !== 'object' ||
        measurements === null ||
        Array.isArray(measurements)
      ) {
        throw this.badRequest(
          'measurements phải là object.',
        );
      }

      const entries = Object.entries(measurements);

      if (entries.length === 0) {
        throw this.badRequest(
          'Mỗi size phải có ít nhất một số đo.',
        );
      }

      for (const [field, value] of entries) {
        if (!field.trim()) {
          throw this.badRequest(
            'Tên thông số đo không được rỗng.',
          );
        }

        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value <= 0
        ) {
          throw this.badRequest(
            `Số đo ${field} phải lớn hơn 0.`,
          );
        }
      }
    }
  }

  // ==========================================
  // NORMALIZE ROWS
  // ==========================================

  private normalizeRows(rows: SizeChartRowDto[]) {
    return rows
      .map((row) => ({
        sizeCode: row.sizeCode,
        measurements: Object.fromEntries(
          Object.entries(row.measurements).sort(
            ([a], [b]) => a.localeCompare(b),
          ),
        ),
      }))
      .sort((a, b) =>
        a.sizeCode.localeCompare(b.sizeCode),
      );
  }

  // ==========================================
  // VALIDATE SIZE CODES IN DATABASE
  // ==========================================

  private async validateSizeCodes(
    tx: Prisma.TransactionClient,
    rows: SizeChartRowDto[],
  ): Promise<void> {
    const codes = rows.map((row) => row.sizeCode);

    const sizes = await tx.size.findMany({
      where: {
        code: { in: codes },
        isActive: true,
      },
      select: { code: true },
    });

    if (sizes.length !== codes.length) {
      throw this.badRequest(
        'Có mã size không tồn tại hoặc đã ngừng sử dụng.',
      );
    }
  }

  // ==========================================
  // POST /api/v1/admin/size-charts
  // ==========================================

  async create(
    dto: SizeChartCreateDto,
    idempotencyKey: string,
    requester: ProductRequester,
  ) {
    const scopeId = this.parseNumber(
      dto.scopeId,
      'scopeId',
      0,
    );

    const name = dto.name.trim();

    if (!name || name.length > 150) {
      throw this.badRequest(
        'Tên bảng số đo không hợp lệ.',
      );
    }

    if (dto.unit !== 'cm') {
      throw this.badRequest(
        'Đơn vị hiện hỗ trợ là cm.',
      );
    }

    if (
      dto.scopeType !== 'PRODUCT' &&
      dto.scopeType !== 'GROUP'
    ) {
      throw this.badRequest(
        'scopeType không hợp lệ.',
      );
    }

    if (
      dto.instructions !== undefined &&
      typeof dto.instructions !== 'string'
    ) {
      throw this.badRequest('instructions phải là chuỗi.');
    }

    this.validateRows(dto.rows);

    const normalizedRows = this.normalizeRows(dto.rows);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          name,
          scopeType: dto.scopeType,
          scopeId,
          unit: dto.unit,
          ...(dto.instructions !== undefined
            ? { instructions: dto.instructions }
            : {}),
          rows: normalizedRows,
        }),
      )
      .digest('hex');

    try {
      return await this.idempotency.execute(
        String(requester.id),
        idempotencyKey,
        'admin.size-charts.create',

        async (tx) => {
          // 1. KIỂM TRA PHẠM VI

          if (dto.scopeType === 'PRODUCT') {
            const product = await tx.product.findUnique({
              where: { id: scopeId },
              select: {
                id: true,
                sizeChartId: true,
              },
            });

            if (!product) {
              throw this.notFound(
                'Sản phẩm không tồn tại.',
              );
            }

            if (product.sizeChartId !== null) {
              throw this.conflict(
                'Sản phẩm đã có bảng số đo riêng.',
              );
            }
          } else {
            const category = await tx.category.findUnique({
              where: { id: scopeId },
              select: {
                id: true,
                sizeChartId: true,
              },
            });

            if (!category) {
              throw this.notFound(
                'Danh mục không tồn tại.',
              );
            }

            if (category.sizeChartId !== null) {
              throw this.conflict(
                'Danh mục đã được gắn bảng số đo.',
              );
            }
          }

          // 2. KIỂM TRA SIZE

          await this.validateSizeCodes(tx, dto.rows);

          // 3. TẠO BẢNG VÀ DÒNG SỐ ĐO

          const chart = await tx.sizeChart.create({
            data: {
              name,
              unit: 'cm',
              ...(dto.instructions !== undefined
                ? { instructions: dto.instructions }
                : {}),
              isActive: true,
              rows: {
                create: normalizedRows.map((row) => ({
                  sizeCode: row.sizeCode,
                  measurements:
                    row.measurements as Prisma.InputJsonObject,
                })),
              },
            },
          });

          // 4. GẮN BẢNG VỚI PHẠM VI

          let updatedCount: number;

          if (dto.scopeType === 'PRODUCT') {
            const updated = await tx.product.updateMany({
              where: {
                id: scopeId,
                sizeChartId: null,
              },
              data: {
                sizeChartId: chart.id,
              },
            });

            updatedCount = updated.count;
          } else {
            const updated = await tx.category.updateMany({
              where: {
                id: scopeId,
                sizeChartId: null,
              },
              data: {
                sizeChartId: chart.id,
              },
            });

            updatedCount = updated.count;
          }

          if (updatedCount !== 1) {
            throw this.conflict(
              'Phạm vi đã được gắn bảng số đo bởi request khác.',
            );
          }

          // 5. RESPONSE

          const response = {
            id: String(chart.id),
            name: chart.name,
            scopeType: dto.scopeType,
            scopeId: String(scopeId),
            unit: chart.unit,
            ...(chart.instructions != null
              ? { instructions: chart.instructions }
              : {}),
            rows: normalizedRows,
            version: chart.version,
          };

          return {
            statusCode: 201,
            data: response as Prisma.JsonObject,
          };
        },

        requestHash,
      );
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.conflict(
          'Dữ liệu bảng số đo đã tồn tại.',
        );
      }

      throw error;
    }
  }

  // ==========================================
  // PATCH /api/v1/admin/size-charts/:chartId
  // ==========================================

  async patch(
    rawChartId: string,
    dto: SizeChartPatchDto,
  ) {
    // ========================================
    // 1. VALIDATE ID, VERSION, PAYLOAD
    // ========================================

    const chartId = this.parseNumber(
      rawChartId,
      'chartId',
      0,
    );

    if (
      !Number.isSafeInteger(dto.version) ||
      dto.version < 1 ||
      dto.version > 2147483647
    ) {
      throw this.badRequest(
        'version phải là số nguyên dương.',
      );
    }

    const hasUpdate =
      dto.name !== undefined ||
      dto.scopeType !== undefined ||
      dto.scopeId !== undefined ||
      dto.unit !== undefined ||
      dto.rows !== undefined ||
      dto.instructions !== undefined;

    if (!hasUpdate) {
      throw this.badRequest(
        'Cần ít nhất một trường cập nhật ngoài version.',
      );
    }

    if (
      dto.instructions !== undefined &&
      typeof dto.instructions !== 'string'
    ) {
      throw this.badRequest('instructions phải là chuỗi.');
    }

    let name: string | undefined;

    if (dto.name !== undefined) {
      if (typeof dto.name !== 'string') {
        throw this.badRequest(
          'Tên bảng số đo không hợp lệ.',
        );
      }

      name = dto.name.trim();

      if (!name || name.length > 150) {
        throw this.badRequest(
          'Tên bảng số đo không hợp lệ.',
        );
      }
    }

    if (
      dto.unit !== undefined &&
      dto.unit !== 'cm'
    ) {
      throw this.badRequest(
        'Đơn vị hiện hỗ trợ là cm.',
      );
    }

    if (
      dto.scopeType !== undefined &&
      dto.scopeType !== 'PRODUCT' &&
      dto.scopeType !== 'GROUP'
    ) {
      throw this.badRequest(
        'scopeType không hợp lệ.',
      );
    }

    const requestedScopeId =
      dto.scopeId !== undefined
        ? this.parseNumber(
            dto.scopeId,
            'scopeId',
            0,
          )
        : undefined;

    let normalizedRows:
      | ReturnType<SizeChartsService['normalizeRows']>
      | undefined;

    if (dto.rows !== undefined) {
      this.validateRows(dto.rows);

      normalizedRows = this.normalizeRows(
        dto.rows,
      );
    }

    // ========================================
    // 2. DATABASE TRANSACTION
    // ========================================

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // ==================================
          // 2.1. LẤY BẢNG HIỆN TẠI
          // ==================================

          const current =
            await tx.sizeChart.findUnique({
              where: { id: chartId },
              include: {
                products: {
                  select: { id: true },
                },
                categories: {
                  select: { id: true },
                },
              },
            });

          if (!current) {
            throw this.notFound(
              'Bảng số đo không tồn tại.',
            );
          }

          // ==================================
          // 2.2. KIỂM TRA PHẠM VI HIỆN TẠI
          // ==================================

          const productCount = current.products.length;
          const categoryCount = current.categories.length;

          if (productCount + categoryCount !== 1) {
            throw this.conflict(
              'Bảng số đo không có phạm vi duy nhất.',
            );
          }

          const oldScopeType: ScopeType =
            productCount === 1
              ? 'PRODUCT'
              : 'GROUP';

          const oldScopeId =
            oldScopeType === 'PRODUCT'
              ? current.products[0].id
              : current.categories[0].id;

          const nextScopeType: ScopeType =
            dto.scopeType ?? oldScopeType;

          // Khi doi PRODUCT <-> GROUP, phai chi ro ID dich.
          // Khong duoc tu dong su dung ID cua loai pham vi cu.
          if (
            nextScopeType !== oldScopeType &&
            requestedScopeId === undefined
          ) {
            throw this.badRequest(
              'Khi thay doi scopeType, bat buoc cung cap scopeId.',
            );
          }

          const nextScopeId =
            requestedScopeId ?? oldScopeId;

          const scopeChanged =
            nextScopeType !== oldScopeType ||
            nextScopeId !== oldScopeId;

          // ==================================
          // 2.3. KIỂM TRA VERSION + KHÓA CẬP NHẬT
          // ==================================

          // UPDATE có điều kiện trên version.
          // Chỉ một PATCH dùng cùng version
          // được phép cập nhật thành công.

          const updated =
            await tx.sizeChart.updateMany({
              where: {
                id: chartId,
                version: dto.version,
              },
              data: {
                ...(name !== undefined
                  ? { name }
                  : {}),

                ...(dto.unit !== undefined
                  ? { unit: dto.unit }
                  : {}),

                ...(dto.instructions !== undefined
                  ? { instructions: dto.instructions }
                  : {}),

                version: {
                  increment: 1,
                },
              },
            });

          if (updated.count !== 1) {
            throw this.conflict(
              'Version đã thay đổi. Vui lòng tải lại bảng số đo.',
            );
          }

          // ==================================
          // 2.4. KIỂM TRA SIZE MỚI
          // ==================================

          if (dto.rows !== undefined) {
            await this.validateSizeCodes(
              tx,
              dto.rows,
            );
          }

          // ==================================
          // 2.5. THAY THẾ DÒNG SỐ ĐO
          // ==================================

          if (normalizedRows !== undefined) {
            await tx.sizeChartRow.deleteMany({
              where: {
                chartId,
              },
            });

            await tx.sizeChartRow.createMany({
              data: normalizedRows.map((row) => ({
                chartId,
                sizeCode: row.sizeCode,
                measurements:
                  row.measurements as Prisma.InputJsonObject,
              })),
            });
          }

          // ==================================
          // 2.6. THAY ĐỔI PHẠM VI NẾU CẦN
          // ==================================

          if (scopeChanged) {
            // Tháo liên kết cũ trong transaction.

            if (oldScopeType === 'PRODUCT') {
              const released =
                await tx.product.updateMany({
                  where: {
                    id: oldScopeId,
                    sizeChartId: chartId,
                  },
                  data: {
                    sizeChartId: null,
                  },
                });

              if (released.count !== 1) {
                throw this.conflict(
                  'Liên kết sản phẩm đã thay đổi.',
                );
              }
            } else {
              const released =
                await tx.category.updateMany({
                  where: {
                    id: oldScopeId,
                    sizeChartId: chartId,
                  },
                  data: {
                    sizeChartId: null,
                  },
                });

              if (released.count !== 1) {
                throw this.conflict(
                  'Liên kết danh mục đã thay đổi.',
                );
              }
            }

            // Gắn phạm vi mới.
            // Chỉ gắn khi chưa có bảng số đo.

            if (nextScopeType === 'PRODUCT') {
              const target =
                await tx.product.findUnique({
                  where: {
                    id: nextScopeId,
                  },
                  select: {
                    id: true,
                    sizeChartId: true,
                  },
                });

              if (!target) {
                throw this.notFound(
                  'Sản phẩm đích không tồn tại.',
                );
              }

              if (target.sizeChartId !== null) {
                throw this.conflict(
                  'Sản phẩm đích đã có bảng số đo.',
                );
              }

              const assigned =
                await tx.product.updateMany({
                  where: {
                    id: nextScopeId,
                    sizeChartId: null,
                  },
                  data: {
                    sizeChartId: chartId,
                  },
                });

              if (assigned.count !== 1) {
                throw this.conflict(
                  'Sản phẩm đích vừa được gắn bảng số đo.',
                );
              }
            } else {
              const target =
                await tx.category.findUnique({
                  where: {
                    id: nextScopeId,
                  },
                  select: {
                    id: true,
                    sizeChartId: true,
                  },
                });

              if (!target) {
                throw this.notFound(
                  'Danh mục đích không tồn tại.',
                );
              }

              if (target.sizeChartId !== null) {
                throw this.conflict(
                  'Danh mục đích đã có bảng số đo.',
                );
              }

              const assigned =
                await tx.category.updateMany({
                  where: {
                    id: nextScopeId,
                    sizeChartId: null,
                  },
                  data: {
                    sizeChartId: chartId,
                  },
                });

              if (assigned.count !== 1) {
                throw this.conflict(
                  'Danh mục đích vừa được gắn bảng số đo.',
                );
              }
            }
          }

          // ==================================
          // 2.7. ĐỌC LẠI BẢNG SAU CẬP NHẬT
          // ==================================

          const finalChart =
            await tx.sizeChart.findUnique({
              where: {
                id: chartId,
              },
              include: {
                rows: {
                  orderBy: {
                    sizeCode: 'asc',
                  },
                },
                products: {
                  select: { id: true },
                },
                categories: {
                  select: { id: true },
                },
              },
            });

          if (!finalChart) {
            throw this.notFound(
              'Bảng số đo không còn tồn tại.',
            );
          }

          return this.toResponse(finalChart);
        },
      );
    } catch (error) {
      // ====================================
      // DATABASE CONFLICT HANDLING
      // ====================================

      if (
        error instanceof
        Prisma.PrismaClientKnownRequestError
      ) {
        if (error.code === 'P2002') {
          throw this.conflict(
            'Dữ liệu bảng số đo bị trùng.',
          );
        }

        if (error.code === 'P2034') {
          throw this.conflict(
            'Có yêu cầu cập nhật đồng thời. Vui lòng thử lại với version mới.',
          );
        }
      }

      throw error;
    }
  }

  // ==========================================
  // DELETE /api/v1/admin/size-charts/:chartId
  // If-Match: quoted resource version, e.g. "4"
  // Only unlinked charts can be deleted.
  // ==========================================

  async remove(rawChartId: string, ifMatch?: string): Promise<void> {
    const chartId = this.parseNumber(rawChartId, 'chartId', 0);

    if (chartId > 2147483647) {
      throw this.badRequest('chartId vượt phạm vi hỗ trợ.');
    }

    if (typeof ifMatch !== 'string' || !/^"[1-9][0-9]*"$/.test(ifMatch)) {
      throw this.badRequest(
        'Header If-Match là bắt buộc và phải có dạng "4".',
      );
    }

    const expectedVersion = Number(ifMatch.slice(1, -1));
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion > 2147483647) {
      throw this.badRequest('Version trong If-Match vượt phạm vi hỗ trợ.');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Khóa bản ghi cha trước khi kiểm tra liên kết. Với MySQL/InnoDB,
        // một giao dịch khác không thể tạo FK tham chiếu mới vào bảng này
        // cho đến khi giao dịch DELETE kết thúc.
        const lockedRows = await tx.$queryRaw<{ id: number }[]>`
          SELECT id
          FROM size_charts
          WHERE id = ${chartId}
          FOR UPDATE
        `;

        if (lockedRows.length === 0) {
          throw this.notFound('Bảng số đo không tồn tại.');
        }

        const chart = await tx.sizeChart.findUnique({
          where: { id: chartId },
          select: {
            id: true,
            version: true,
            products: { select: { id: true } },
            categories: { select: { id: true } },
          },
        });

        if (!chart) {
          throw this.notFound('Bảng số đo không tồn tại.');
        }

        if (chart.version !== expectedVersion) {
          throw new ConflictException(
            apiErrorPayload(
              ErrorCode.VERSION_CONFLICT,
              'Version đã thay đổi. Vui lòng tải lại bảng số đo.',
            ),
          );
        }

        if (chart.products.length > 0 || chart.categories.length > 0) {
          throw this.conflict(
            'Không thể xóa bảng số đo đang liên kết với sản phẩm hoặc danh mục.',
          );
        }

        // Version-conditional delete protects against concurrent PATCH.
        // Related SizeChartRow records use ON DELETE CASCADE.
        const deleted = await tx.sizeChart.deleteMany({
          where: { id: chartId, version: expectedVersion },
        });

        if (deleted.count !== 1) {
          throw new ConflictException(
            apiErrorPayload(
              ErrorCode.VERSION_CONFLICT,
              'Version đã thay đổi. Vui lòng tải lại bảng số đo.',
            ),
          );
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw this.conflict(
            'Không thể xóa bảng số đo đang được tham chiếu.',
          );
        }
        if (error.code === 'P2034') {
          throw this.conflict(
            'Có yêu cầu cập nhật đồng thời. Vui lòng thử lại.',
          );
        }
      }
      throw error;
    }
  }
}
