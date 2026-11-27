
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

@Injectable()
export class ProductOptionsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private badRequest(message: string): BadRequestException {
    return new BadRequestException(
      apiErrorPayload(
        ErrorCode.VALIDATION_ERROR,
        message,
      ),
    );
  }

  private parsePageLimit(
    rawPage?: string,
    rawLimit?: string,
  ) {
    const parse = (
      value: string | undefined,
      field: string,
      fallback: number,
    ): number => {
      if (value === undefined) {
        return fallback;
      }

      if (!/^[1-9][0-9]*$/.test(value)) {
        throw this.badRequest(
          `${field} phải là số nguyên dương.`,
        );
      }

      const result = Number(value);

      if (!Number.isSafeInteger(result)) {
        throw this.badRequest(
          `${field} vượt quá phạm vi hỗ trợ.`,
        );
      }

      return result;
    };

    const page = parse(rawPage, 'page', 1);
    const limit = parse(rawLimit, 'limit', 20);

    if (limit > 100) {
      throw this.badRequest(
        'limit không được lớn hơn 100.',
      );
    }

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      throw this.badRequest(
        'page vượt quá phạm vi hỗ trợ.',
      );
    }

    return { page, limit, skip };
  }

  // ==========================================
  // GET /api/v1/admin/colors
  // ==========================================

  async listColors(
    page?: string,
    limit?: string,
  ) {
    const pagination = this.parsePageLimit(
      page,
      limit,
    );

    const where: Prisma.ColorWhereInput = {};

    const [items, total] = await Promise.all([
      this.prisma.color.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
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
      }),

      this.prisma.color.count({ where }),
    ]);

    return {
      items: items.map((color) => ({
        id: String(color.id),
        name: color.name,
        skuSuffix: color.skuSuffix,
        groupId: String(color.groupId),
      })),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
      },
    };
  }

  // ==========================================
  // GET /api/v1/admin/sizes
  // ==========================================

  async listSizes(
    page?: string,
    limit?: string,
  ) {
    const pagination = this.parsePageLimit(
      page,
      limit,
    );

    const where: Prisma.SizeWhereInput = {};

    const [items, total] = await Promise.all([
      this.prisma.size.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: [
          { sortOrder: Prisma.SortOrder.asc },
          { code: Prisma.SortOrder.asc },
        ],
        select: {
          code: true,
          name: true,
          skuSuffix: true,
        },
      }),

      this.prisma.size.count({ where }),
    ]);

    return {
      items: items.map((size) => ({
        code: size.code,
        label: size.name,
        skuSuffix: size.skuSuffix,
      })),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
      },
    };
  }
}
