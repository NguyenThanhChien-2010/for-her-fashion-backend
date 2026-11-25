
import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  UserRole,
} from '@prisma/client';

import {
  PrismaService,
} from '../prisma/prisma.service';

import {
  IdempotencyService,
} from '../../common/services/idempotency.service';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import {
  VariantCreateDto,
} from './dto/variant-create.dto';

import type {
  ProductRequester,
} from './products.service';

@Injectable()
export class ProductVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ==========================================
  // ERROR HELPERS
  // ==========================================

  private badRequest(
    message: string,
  ): BadRequestException {
    return new BadRequestException(
      apiErrorPayload(
        ErrorCode.VALIDATION_ERROR,
        message,
      ),
    );
  }

  private conflict(
    message: string,
  ): ConflictException {
    return new ConflictException(
      apiErrorPayload(
        ErrorCode.CONFLICT,
        message,
      ),
    );
  }

  private notFound(
    message: string,
  ): NotFoundException {
    return new NotFoundException(
      apiErrorPayload(
        ErrorCode.NOT_FOUND,
        message,
      ),
    );
  }

  // ==========================================
  // ID VALIDATION
  // ==========================================

  private parseId(
    value: string,
  ): number {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw this.badRequest(
        'ID không hợp lệ.',
      );
    }

    const id = Number(value);

    if (!Number.isSafeInteger(id)) {
      throw this.badRequest(
        'ID vượt phạm vi hỗ trợ.',
      );
    }

    return id;
  }

  // ==========================================
  // REQUEST HASH
  // ==========================================

  private createRequestHash(
    productId: number,
    colorId: number,
    sizeCode: string,
  ): string {
    const payload = {
      productId,
      colorId,
      sizeCode,
    };

    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  // ==========================================
  // POST /api/v1/admin/products/:productId/variants
  // ==========================================

  async create(
    productIdValue: string,
    dto: VariantCreateDto,
    idempotencyKey: string,
    requester: ProductRequester,
  ) {
    // ========================================
    // 1. PHÂN QUYỀN
    // ========================================

    if (requester.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'Chỉ ADMIN được tạo biến thể.',
        ),
      );
    }

    // ========================================
    // 2. VALIDATE INPUT
    // ========================================

    const productId = this.parseId(
      productIdValue,
    );

    const colorId = this.parseId(
      dto.colorId,
    );

    const sizeCode = dto.sizeCode;

    if (
      typeof sizeCode !== 'string' ||
      sizeCode.length === 0 ||
      sizeCode.length > 10 ||
      !/^\S+$/.test(sizeCode)
    ) {
      throw this.badRequest(
        'Mã size không hợp lệ.',
      );
    }

    // ========================================
    // 3. TÍNH HASH THEO REQUEST
    // ========================================

    const requestHash =
      this.createRequestHash(
        productId,
        colorId,
        sizeCode,
      );

    try {
      return await this.idempotency.execute(
        String(requester.id),
        idempotencyKey,
        'admin.products.variants.create',

        async (tx) => {
          // ==================================
          // 4. KIỂM TRA PRODUCT, COLOR, SIZE
          // ==================================

          const [product, color, size] =
            await Promise.all([
              tx.product.findUnique({
                where: {
                  id: productId,
                },
                select: {
                  id: true,
                  baseCode: true,
                },
              }),

              tx.color.findUnique({
                where: {
                  id: colorId,
                },
                select: {
                  id: true,
                  skuSuffix: true,
                },
              }),

              tx.size.findUnique({
                where: {
                  code: sizeCode,
                },
                select: {
                  code: true,
                  skuSuffix: true,
                  isActive: true,
                },
              }),
            ]);

          if (!product) {
            throw this.notFound(
              'Sản phẩm không tồn tại.',
            );
          }

          if (!color || !size) {
            throw this.notFound(
              'Màu hoặc size không tồn tại.',
            );
          }

          if (!size.isActive) {
            throw this.badRequest(
              'Không thể tạo biến thể với size đã ngừng sử dụng.',
            );
          }

          // ==================================
          // 5. TỰ ĐỘNG SINH SKU
          // ==================================

          const sku =
            product.baseCode +
            color.skuSuffix +
            size.skuSuffix;

          if (sku.length > 80) {
            throw this.badRequest(
              'SKU vượt quá độ dài tối đa 80 ký tự.',
            );
          }

          // ==================================
          // 6. KIỂM TRA TRÙNG SKU/TỔ HỢP
          // ==================================

          const existing =
            await tx.productVariant.findFirst({
              where: {
                OR: [
                  {
                    sku,
                  },
                  {
                    productId,
                    colorId,
                    sizeCode,
                  },
                ],
              },
              select: {
                id: true,
              },
            });

          if (existing) {
            throw this.conflict(
              'SKU hoặc tổ hợp sản phẩm/màu/size đã tồn tại.',
            );
          }

          // ==================================
          // 7. TẠO BIẾN THỂ
          // ==================================

          // Unique constraints trong MySQL
          // là lớp bảo vệ cuối cùng khi
          // có nhiều request đồng thời.

          const created =
            await tx.productVariant.create({
              data: {
                productId,
                colorId,
                sizeCode,
                sku,
                isActive: true,
              },
            });

          // ==================================
          // 8. RESPONSE THEO OPENAPI
          // ==================================

          const response = {
            id: String(created.id),
            productId: String(
              created.productId,
            ),
            colorId: String(
              created.colorId,
            ),
            sizeCode:
              created.sizeCode,
            sku: created.sku,
            status: created.isActive
              ? 'ACTIVE'
              : 'INACTIVE',
            version: created.version,
          };

          // ==================================
          // 9. AUDIT LOG
          // ==================================

          await tx.auditLog.create({
            data: {
              actorId: this.parseId(
                String(requester.id),
              ),
              action:
                'PRODUCT_VARIANT_CREATE',
              entityType:
                'ProductVariant',
              entityId: String(
                created.id,
              ),
              after:
                response as Prisma.JsonObject,
            },
          });

          // ==================================
          // 10. RESULT
          // ==================================

          return {
            statusCode: 201,
            data:
              response as Prisma.JsonObject,
          };
        },

        // Tham số thứ 5:
        // chống cùng key nhưng khác dữ liệu.
        requestHash,
      );
    } catch (error) {
      // ====================================
      // DB UNIQUE CONSTRAINT
      // ====================================

      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.conflict(
          'SKU hoặc tổ hợp sản phẩm/màu/size đã tồn tại.',
        );
      }

      throw error;
    }
  }
}
