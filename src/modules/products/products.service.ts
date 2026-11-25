import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Product,
  ProductImage,
  ProductStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import { ProductCreateDto } from './dto/product-create.dto';
import { ProductPatchDto } from './dto/product-patch.dto';

export interface ProductRequester {
  id: number | string;
  role: UserRole;
}

export interface ProductResponse {
  id: string;
  name: string;
  slug: string;
  baseCode: string;
  categoryId: string;
  price: number;
  description?: string;
  status: ProductStatus;
  imageFileIds: string[];
  version: number;
}

export interface PaginatedProducts {
  items: ProductResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

type ProductWithImages = Product & {
  images: ProductImage[];
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private badRequest(message: string): BadRequestException {
    return new BadRequestException(
      apiErrorPayload(ErrorCode.VALIDATION_ERROR, message),
    );
  }

  private conflict(message: string): ConflictException {
    return new ConflictException(
      apiErrorPayload(ErrorCode.CONFLICT, message),
    );
  }

  private notFound(message: string): NotFoundException {
    return new NotFoundException(
      apiErrorPayload(ErrorCode.NOT_FOUND, message),
    );
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException(
      apiErrorPayload(ErrorCode.FORBIDDEN, message),
    );
  }

  private parseId(value: string): number {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw this.badRequest('ID không hợp lệ.');
    }

    const id = Number(value);

    if (!Number.isSafeInteger(id)) {
      throw this.badRequest('ID vượt quá phạm vi hỗ trợ.');
    }

    return id;
  }

  private toResponse(product: ProductWithImages): ProductResponse {
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
      imageFileIds: product.images.map((image) =>
        String(image.fileId),
      ),
      version: product.version,
    };
  }

  private assertAdmin(requester: ProductRequester): void {
    if (requester.role !== UserRole.ADMIN) {
      throw this.forbidden('Chỉ ADMIN được thực hiện thao tác này.');
    }
  }

  private assertManagementRole(
    requester: ProductRequester,
  ): void {
    if (
      requester.role !== UserRole.ADMIN &&
      requester.role !== UserRole.STAFF
    ) {
      throw this.forbidden('Bạn không có quyền quản lý sản phẩm.');
    }
  }

  private assertPatchPermission(
    dto: ProductPatchDto,
    requester: ProductRequester,
  ): void {
    this.assertManagementRole(requester);

    if (requester.role === UserRole.ADMIN) {
      return;
    }

    const allowed = new Set([
      'version',
      'name',
      'description',
      'imageFileIds',
    ]);

    // class-transformer có thể tạo thuộc tính tùy chọn với giá trị undefined.
    // Chỉ kiểm tra các trường thực sự có giá trị trong request.
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) {
        continue;
      }

      if (!allowed.has(key)) {
        throw this.forbidden(
          `STAFF không có quyền cập nhật trường ${key}.`,
        );
      }
    }
  }

  private async validateFiles(
    tx: Prisma.TransactionClient,
    fileIds: number[],
  ): Promise<void> {
    if (fileIds.length === 0) return;

    if (new Set(fileIds).size !== fileIds.length) {
      throw this.badRequest('Danh sách ảnh bị trùng.');
    }

    const count = await tx.file.count({
      where: {
        id: { in: fileIds },
      },
    });

    if (count !== fileIds.length) {
      throw this.badRequest(
        'Một hoặc nhiều file ảnh không tồn tại.',
      );
    }
  }

  private parseFileIds(values: string[]): number[] {
    return values.map((value) => this.parseId(value));
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw this.conflict(
          'Slug, mã sản phẩm hoặc dữ liệu duy nhất đã tồn tại.',
        );
      }

      if (error.code === 'P2003') {
        throw this.conflict(
          'Dữ liệu đang được tham chiếu bởi bảng khác.',
        );
      }
    }

    throw error;
  }

  // GET /api/v1/admin/products
  async listAdmin(
    page = 1,
    limit = 20,
  ): Promise<PaginatedProducts> {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw this.badRequest('Phân trang không hợp lệ.');
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          images: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      }),
      this.prisma.product.count(),
    ]);

    return {
      items: items.map((item) => this.toResponse(item)),
      pagination: { page, limit, total },
    };
  }

  // POST /api/v1/admin/products
  async create(
    dto: ProductCreateDto,
    idempotencyKey: string,
    requester: ProductRequester,
  ): Promise<ProductResponse> {
    this.assertAdmin(requester);

    const name = dto.name.trim();
    const slug = dto.slug.trim();
    const baseCode = dto.baseCode.trim();

    if (!name || !slug || !baseCode) {
      throw this.badRequest(
        'Tên, slug và mã sản phẩm không được để trống.',
      );
    }

    const categoryId = this.parseId(dto.categoryId);
    const actorId = this.parseId(String(requester.id));
    const fileIds = this.parseFileIds(dto.imageFileIds ?? []);

    try {
      const result = await this.idempotency.execute(
        String(requester.id),
        idempotencyKey,
        'admin.products.create',
        async (tx) => {
          const category = await tx.category.findUnique({
            where: { id: categoryId },
            select: { id: true },
          });

          if (!category) {
            throw this.notFound('Danh mục không tồn tại.');
          }

          await this.validateFiles(tx, fileIds);

          const existing = await tx.product.findFirst({
            where: {
              OR: [{ slug }, { baseCode }],
            },
            select: { id: true },
          });

          if (existing) {
            throw this.conflict(
              'Slug hoặc mã sản phẩm đã tồn tại.',
            );
          }

          const created = await tx.product.create({
            data: {
              name,
              slug,
              baseCode,
              categoryId,
              price: new Prisma.Decimal(dto.price),
              description: dto.description ?? null,
              status: ProductStatus[dto.status],
              images: {
                create: fileIds.map((fileId, index) => ({
                  fileId,
                  sortOrder: index,
                })),
              },
            },
            include: {
              images: {
                orderBy: { sortOrder: 'asc' },
              },
            },
          });

          const response = this.toResponse(created);

          await tx.auditLog.create({
            data: {
              actorId,
              action: 'PRODUCT_CREATE',
              entityType: 'Product',
              entityId: String(created.id),
              after: response as unknown as Prisma.JsonObject,
            },
          });

          return {
            statusCode: 201,
            data: response as unknown as Prisma.JsonObject,
          };
        },
      );

      return result as unknown as ProductResponse;
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  // PATCH /api/v1/admin/products/:productId
  async update(
    productId: string,
    dto: ProductPatchDto,
    requester: ProductRequester,
  ): Promise<ProductResponse> {
    this.assertPatchPermission(dto, requester);

    if (!Number.isInteger(dto.version) || dto.version < 1) {
      throw this.badRequest('Version không hợp lệ.');
    }

    const changes = Object.entries(dto).filter(
      ([key, value]) => key !== 'version' && value !== undefined,
    );

    if (changes.length === 0) {
      throw this.badRequest(
        'Phải có ít nhất một trường cần cập nhật.',
      );
    }

    const id = this.parseId(productId);
    const actorId = this.parseId(String(requester.id));

    const data: Prisma.ProductUncheckedUpdateManyInput = {
      version: { increment: 1 },
    };

    if (dto.name !== undefined) {
      if (!dto.name.trim()) {
        throw this.badRequest('Tên sản phẩm không được để trống.');
      }
      data.name = dto.name.trim();
    }

    if (dto.slug !== undefined) {
      if (!dto.slug.trim()) {
        throw this.badRequest('Slug không được để trống.');
      }
      data.slug = dto.slug.trim();
    }

    if (dto.baseCode !== undefined) {
      if (!dto.baseCode.trim()) {
        throw this.badRequest('Mã sản phẩm không được để trống.');
      }
      data.baseCode = dto.baseCode.trim();
    }

    if (dto.categoryId !== undefined) {
      data.categoryId = this.parseId(dto.categoryId);
    }

    if (dto.price !== undefined) {
      data.price = new Prisma.Decimal(dto.price);
    }

    if (dto.description !== undefined) {
      data.description = dto.description;
    }

    if (dto.status !== undefined) {
      data.status = ProductStatus[dto.status];
    }

    const fileIds =
      dto.imageFileIds !== undefined
        ? this.parseFileIds(dto.imageFileIds)
        : undefined;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.product.findUnique({
          where: { id },
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        });

        if (!current) {
          throw this.notFound('Sản phẩm không tồn tại.');
        }

        if (current.version !== dto.version) {
          throw this.conflict(
            'Sản phẩm đã được cập nhật bởi yêu cầu khác.',
          );
        }

        if (
          dto.baseCode !== undefined &&
          dto.baseCode.trim() !== current.baseCode
        ) {
          const variantCount = await tx.productVariant.count({
            where: { productId: id },
          });

          if (variantCount > 0) {
            throw this.conflict(
              'Không thể đổi mã gốc khi sản phẩm đã có biến thể.',
            );
          }
        }

        if (dto.categoryId !== undefined) {
          const category = await tx.category.findUnique({
            where: { id: this.parseId(dto.categoryId) },
            select: { id: true },
          });

          if (!category) {
            throw this.notFound('Danh mục không tồn tại.');
          }
        }

        if (fileIds !== undefined) {
          await this.validateFiles(tx, fileIds);
        }

        const updatedCount = await tx.product.updateMany({
          where: {
            id,
            version: dto.version,
          },
          data,
        });

        if (updatedCount.count !== 1) {
          throw this.conflict(
            'Version đã thay đổi. Vui lòng tải lại sản phẩm.',
          );
        }

        if (fileIds !== undefined) {
          await tx.productImage.deleteMany({
            where: { productId: id },
          });

          if (fileIds.length > 0) {
            await tx.productImage.createMany({
              data: fileIds.map((fileId, index) => ({
                productId: id,
                fileId,
                sortOrder: index,
              })),
            });
          }
        }

        const updated = await tx.product.findUniqueOrThrow({
          where: { id },
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        });

        const before = this.toResponse(current);
        const after = this.toResponse(updated);

        await tx.auditLog.create({
          data: {
            actorId,
            action: 'PRODUCT_UPDATE',
            entityType: 'Product',
            entityId: String(id),
            before: before as unknown as Prisma.JsonObject,
            after: after as unknown as Prisma.JsonObject,
          },
        });

        return after;
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }
}
