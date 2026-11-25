
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

@Injectable()
export class PublicProductsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private parseProductId(value: string): number {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID sản phẩm không hợp lệ.',
        ),
      );
    }

    const id = Number(value);

    if (!Number.isSafeInteger(id)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID sản phẩm vượt quá phạm vi hỗ trợ.',
        ),
      );
    }

    return id;
  }

  async findOne(productId: string) {
    const id = this.parseProductId(productId);

    const product = await this.prisma.product.findFirst({
      where: {
        id,
        status: ProductStatus.ACTIVE,
      },
      include: {
        images: {
          orderBy: [
            { sortOrder: Prisma.SortOrder.asc },
            { id: Prisma.SortOrder.asc },
          ],
        },
      },
    });

    if (!product) {
      throw new NotFoundException(
        apiErrorPayload(
          ErrorCode.NOT_FOUND,
          'Sản phẩm không tồn tại hoặc không được hiển thị.',
        ),
      );
    }

    return {
      id: String(product.id),
      name: product.name,
      slug: product.slug,
      baseCode: product.baseCode,
      categoryId: String(product.categoryId),
      price: Number(product.price),

      ...(product.description !== null
        ? { description: product.description }
        : {}),

      status: product.status,

      imageFileIds: product.images.map(
        (image) => String(image.fileId),
      ),

      version: product.version,
    };
  }
}
