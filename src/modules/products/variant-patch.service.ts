import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';

import { apiErrorPayload, ErrorCode } from '../../common/errors/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { VariantPatchDto } from './dto/variant-patch.dto';
import type { ProductRequester } from './products.service';

@Injectable()
export class VariantPatchService {
  constructor(private readonly prisma: PrismaService) {}

  private parseId(value: string): number {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID biến thể không hợp lệ.',
        ),
      );
    }

    const id = Number(value);

    if (!Number.isSafeInteger(id)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID vượt phạm vi hỗ trợ.',
        ),
      );
    }

    return id;
  }

  async update(
    variantIdValue: string,
    dto: VariantPatchDto,
    requester: ProductRequester,
  ) {
    const variantId = this.parseId(variantIdValue);
    const actorId = this.parseId(String(requester.id));

    if (
      requester.role !== UserRole.ADMIN &&
      requester.role !== UserRole.STAFF
    ) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'Bạn không có quyền cập nhật biến thể.',
        ),
      );
    }

    if (
      !Number.isSafeInteger(dto.version) ||
      dto.version < 1
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Version không hợp lệ.',
        ),
      );
    }

    const hasStatus = dto.status !== undefined;
    const hasColorLabel = dto.colorDisplayLabel !== undefined;
    const hasSizeLabel = dto.sizeDisplayLabel !== undefined;

    if (!hasStatus && !hasColorLabel && !hasSizeLabel) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Phải cung cấp ít nhất một trường cần cập nhật.',
        ),
      );
    }

    if (
      requester.role === UserRole.STAFF &&
      hasStatus
    ) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'STAFF không được cập nhật trạng thái biến thể.',
        ),
      );
    }

    if (
      hasStatus &&
      dto.status !== 'ACTIVE' &&
      dto.status !== 'INACTIVE'
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Trạng thái biến thể không hợp lệ.',
        ),
      );
    }

    for (const value of [
      dto.colorDisplayLabel,
      dto.sizeDisplayLabel,
    ]) {
      if (
        value !== undefined &&
        (
          typeof value !== 'string' ||
          value.length < 1 ||
          value.length > 100
        )
      ) {
        throw new BadRequestException(
          apiErrorPayload(
            ErrorCode.VALIDATION_ERROR,
            'Nhãn hiển thị không hợp lệ.',
          ),
        );
      }
    }

    const data: Prisma.ProductVariantUpdateManyMutationInput = {
      version: { increment: 1 },
    };

    if (hasStatus) {
      data.isActive = dto.status === 'ACTIVE';
    }

    if (hasColorLabel) {
      data.colorDisplayLabel = dto.colorDisplayLabel;
    }

    if (hasSizeLabel) {
      data.sizeDisplayLabel = dto.sizeDisplayLabel;
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.productVariant.findUnique({
        where: { id: variantId },
      });

      if (!before) {
        throw new NotFoundException(
          apiErrorPayload(
            ErrorCode.NOT_FOUND,
            'Biến thể không tồn tại.',
          ),
        );
      }

      if (before.version !== dto.version) {
        throw new ConflictException(
          apiErrorPayload(
            ErrorCode.VERSION_CONFLICT,
            'Version biến thể đã thay đổi.',
          ),
        );
      }

      const result = await tx.productVariant.updateMany({
        where: {
          id: variantId,
          version: dto.version,
        },
        data,
      });

      if (result.count !== 1) {
        throw new ConflictException(
          apiErrorPayload(
            ErrorCode.VERSION_CONFLICT,
            'Version biến thể đã thay đổi.',
          ),
        );
      }

      const updated = await tx.productVariant.findUniqueOrThrow({
        where: { id: variantId },
      });

      const response = {
        id: String(updated.id),
        productId: String(updated.productId),
        colorId: String(updated.colorId),
        sizeCode: updated.sizeCode,
        sku: updated.sku,
        status: updated.isActive ? 'ACTIVE' : 'INACTIVE',
        version: updated.version,
      };

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'PRODUCT_VARIANT_UPDATE',
          entityType: 'ProductVariant',
          entityId: String(variantId),
          before: {
            status: before.isActive ? 'ACTIVE' : 'INACTIVE',
            colorDisplayLabel: before.colorDisplayLabel,
            sizeDisplayLabel: before.sizeDisplayLabel,
            version: before.version,
          } as Prisma.JsonObject,
          after: {
            ...response,
            colorDisplayLabel: updated.colorDisplayLabel,
            sizeDisplayLabel: updated.sizeDisplayLabel,
          } as Prisma.JsonObject,
        },
      });

      return response;
    });
  }
}