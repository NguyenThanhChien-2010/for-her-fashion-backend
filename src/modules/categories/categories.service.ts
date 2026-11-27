
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Category, Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import { CategoryCreateDto } from './dto/category-create.dto';
import { CategoryPatchDto } from './dto/category-patch.dto';
import { CategoryQueryDto } from './dto/category-query.dto';

// ==========================================
// RESPONSE TYPES
// ==========================================

export interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isVisible: boolean;
  version: number;
}

export interface PaginatedCategories {
  items: CategoryResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface CategoryRequester {
  id: string | number;
  role: UserRole;
}

// ==========================================
// CATEGORIES SERVICE
// ==========================================

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ========================================
  // GET /api/v1/categories
  // ========================================

  async listPublic(
    query: CategoryQueryDto,
  ): Promise<PaginatedCategories> {
    return this.findCategories(query, {
      isActive: true,
    });
  }

  // ========================================
  // GET /api/v1/admin/categories
  // ========================================

  async listAdmin(
    query: CategoryQueryDto,
  ): Promise<PaginatedCategories> {
    return this.findCategories(query, {});
  }

  // ========================================
  // POST /api/v1/admin/categories
  // ========================================

  async create(
    dto: CategoryCreateDto,
    idempotencyKey: string,
    requester: CategoryRequester,
  ): Promise<CategoryResponse> {
    this.assertManagementRole(requester);

    const name = dto.name.trim();
    const slug = dto.slug.trim();

    if (!name || !slug) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Tên và slug không được để trống.',
        ),
      );
    }

    const parentId =
      dto.parentId == null
        ? null
        : this.parseCategoryId(dto.parentId);

    // Actor ID dùng kiểu number trong AuditLog.
    const actorId = this.parseCategoryId(
      String(requester.id),
    );

    // IdempotencyService yêu cầu subjectKey là string.
    const subjectKey = String(requester.id);

    try {
      const result = await this.idempotency.execute(
        subjectKey,
        idempotencyKey,
        'admin.categories.create',
        async (tx) => {
          // Kiểm tra danh mục cha.
          if (parentId !== null) {
            const parent = await tx.category.findUnique({
              where: {
                id: parentId,
              },
              select: {
                id: true,
              },
            });

            if (!parent) {
              throw new NotFoundException(
                apiErrorPayload(
                  ErrorCode.NOT_FOUND,
                  'Danh mục cha không tồn tại.',
                ),
              );
            }
          }

          // Kiểm tra slug đã tồn tại.
          const duplicate = await tx.category.findUnique({
            where: {
              slug,
            },
            select: {
              id: true,
            },
          });

          if (duplicate) {
            throw this.conflict(
              'Slug danh mục đã tồn tại.',
            );
          }

          // Tạo danh mục trong transaction.
          const category = await tx.category.create({
            data: {
              name,
              slug,
              parentId,
              isActive: dto.isVisible,
            },
          });

          const response = this.toCategoryResponse(
            category,
          );

          // Ghi nhật ký quản trị.
          await tx.auditLog.create({
            data: {
              actorId,
              action: 'CATEGORY_CREATE',
              entityType: 'Category',
              entityId: String(category.id),
              after: {
                name: response.name,
                slug: response.slug,
                parentId: response.parentId,
                isVisible: response.isVisible,
                version: response.version,
              },
            },
          });

          return {
            statusCode: 201,
            data: response as unknown as Prisma.JsonObject,
          };
        },
      );

      return result as unknown as CategoryResponse;
    } catch (error) {
      this.handleDatabaseConflict(error);
      throw error;
    }
  }

  // ========================================
  // PATCH /api/v1/admin/categories/:categoryId
  // ========================================

  async update(
    categoryId: string,
    dto: CategoryPatchDto,
    requester: CategoryRequester,
  ): Promise<CategoryResponse> {
    this.assertManagementRole(requester);

    const id = this.parseCategoryId(categoryId);

    const actorId = this.parseCategoryId(
      String(requester.id),
    );

    // Phải có ít nhất một trường cần sửa.
    const hasChanges =
      dto.name !== undefined ||
      dto.slug !== undefined ||
      dto.parentId !== undefined ||
      dto.isVisible !== undefined;

    if (!hasChanges) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Cần có ít nhất một trường cập nhật ngoài version.',
        ),
      );
    }

    // Kiểm tra version.
    if (
      !Number.isSafeInteger(dto.version) ||
      dto.version < 1 ||
      dto.version > 2147483647
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Version không hợp lệ.',
        ),
      );
    }

    // UncheckedUpdateManyInput cho phép sửa parentId.
    const data: Prisma.CategoryUncheckedUpdateManyInput = {
      version: {
        increment: 1,
      },
    };

    // Cập nhật tên danh mục.
    if (dto.name !== undefined) {
      const name = dto.name.trim();

      if (!name) {
        throw new BadRequestException(
          apiErrorPayload(
            ErrorCode.VALIDATION_ERROR,
            'Tên danh mục không được để trống.',
          ),
        );
      }

      data.name = name;
    }

    // Cập nhật slug.
    if (dto.slug !== undefined) {
      const slug = dto.slug.trim();

      if (!slug) {
        throw new BadRequestException(
          apiErrorPayload(
            ErrorCode.VALIDATION_ERROR,
            'Slug không được để trống.',
          ),
        );
      }

      data.slug = slug;
    }

    // Cập nhật trạng thái hiển thị.
    if (dto.isVisible !== undefined) {
      data.isActive = dto.isVisible;
    }

    // ======================================
    // XỬ LÝ DANH MỤC CHA - ĐÃ SỬA TS2451, TS2345
    // ======================================

    const hasParentChange = dto.parentId !== undefined;

    // Chỉ khai báo nextParentId một lần.
    // undefined hoặc null -> null tại biến tạm.
    // Chỉ ghi parentId khi hasParentChange = true.
    const nextParentId =
      dto.parentId == null
        ? null
        : this.parseCategoryId(dto.parentId);

    if (hasParentChange) {
      if (nextParentId === id) {
        throw this.conflict(
          'Danh mục không thể làm cha của chính nó.',
        );
      }

      data.parentId = nextParentId;
    }

    // ======================================
    // TRANSACTION CẬP NHẬT
    // ======================================

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.category.findUnique({
            where: {
              id,
            },
          });

          if (!existing) {
            throw new NotFoundException(
              apiErrorPayload(
                ErrorCode.NOT_FOUND,
                'Danh mục không tồn tại.',
              ),
            );
          }

          // Optimistic locking.
          if (existing.version !== dto.version) {
            throw this.conflict(
              'Dữ liệu đã thay đổi. Vui lòng tải lại danh mục.',
            );
          }

          // Kiểm tra slug trùng.
          if (dto.slug !== undefined) {
            const duplicate = await tx.category.findUnique({
              where: {
                slug: dto.slug.trim(),
              },
              select: {
                id: true,
              },
            });

            if (duplicate && duplicate.id !== id) {
              throw this.conflict(
                'Slug danh mục đã tồn tại.',
              );
            }
          }

          // Kiểm tra quan hệ cha/con.
          if (
            hasParentChange &&
            nextParentId !== null
          ) {
            await this.assertValidParent(
              tx,
              id,
              nextParentId,
            );
          }

          // Cập nhật có kiểm tra version.
          const updated = await tx.category.updateMany({
            where: {
              id,
              version: dto.version,
            },
            data,
          });

          if (updated.count !== 1) {
            throw this.conflict(
              'Xung đột phiên bản. Vui lòng thử lại.',
            );
          }

          // Lấy lại dữ liệu đã cập nhật.
          const category =
            await tx.category.findUniqueOrThrow({
              where: {
                id,
              },
            });

          const response = this.toCategoryResponse(
            category,
          );

          // Ghi AuditLog trong cùng transaction.
          await tx.auditLog.create({
            data: {
              actorId,
              action: 'CATEGORY_UPDATE',
              entityType: 'Category',
              entityId: String(id),
              before: {
                name: existing.name,
                slug: existing.slug,
                parentId:
                  existing.parentId === null
                    ? null
                    : String(existing.parentId),
                isVisible: existing.isActive,
                version: existing.version,
              },
              after: {
                name: response.name,
                slug: response.slug,
                parentId: response.parentId,
                isVisible: response.isVisible,
                version: response.version,
              },
            },
          });

          return response;
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      this.handleDatabaseConflict(error);
      throw error;
    }
  }

  // ========================================
  // DELETE /api/v1/admin/categories/:categoryId
  // ========================================

  async remove(
    categoryId: string,
    ifMatch: string | undefined,
    requester: CategoryRequester,
  ): Promise<void> {
    // ADM-07: ADMIN và STAFF được xóa danh mục không còn ràng buộc.
    this.assertManagementRole(requester);

    const id = this.parseCategoryId(categoryId);

    const expectedVersion = this.parseIfMatch(
      ifMatch,
    );

    const actorId = this.parseCategoryId(
      String(requester.id),
    );

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const category = await tx.category.findUnique({
            where: {
              id,
            },
          });

          if (!category) {
            throw new NotFoundException(
              apiErrorPayload(
                ErrorCode.NOT_FOUND,
                'Danh mục không tồn tại.',
              ),
            );
          }

          // Kiểm tra version trước khi xóa.
          if (category.version !== expectedVersion) {
            throw this.conflict(
              'Phiên bản danh mục không khớp.',
            );
          }

          // Không được xóa khi có danh mục con.
          const childCount = await tx.category.count({
            where: {
              parentId: id,
            },
          });

          if (childCount > 0) {
            throw this.conflict(
              'Không thể xóa danh mục đang có danh mục con.',
            );
          }

          // Không được xóa khi có sản phẩm.
          const productCount = await tx.product.count({
            where: {
              categoryId: id,
            },
          });

          if (productCount > 0) {
            throw this.conflict(
              'Không thể xóa danh mục đang có sản phẩm.',
            );
          }

          // Xóa có kiểm tra version.
          const deleted = await tx.category.deleteMany({
            where: {
              id,
              version: expectedVersion,
            },
          });

          if (deleted.count !== 1) {
            throw this.conflict(
              'Danh mục đã bị thay đổi hoặc xóa.',
            );
          }

          // AuditLog lưu lịch sử xóa.
          await tx.auditLog.create({
            data: {
              actorId,
              action: 'CATEGORY_DELETE',
              entityType: 'Category',
              entityId: String(id),
              before: {
                name: category.name,
                slug: category.slug,
                parentId:
                  category.parentId === null
                    ? null
                    : String(category.parentId),
                isVisible: category.isActive,
                version: category.version,
              },
              after: {
                deleted: true,
              },
            },
          });
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      this.handleDatabaseConflict(error);
      throw error;
    }
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private async findCategories(
    query: CategoryQueryDto,
    where: Prisma.CategoryWhereInput,
  ): Promise<PaginatedCategories> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [categories, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [
          {
            sortOrder: 'asc',
          },
          {
            id: 'asc',
          },
        ],
      }),
      this.prisma.category.count({
        where,
      }),
    ]);

    return {
      items: categories.map((category) =>
        this.toCategoryResponse(category),
      ),
      pagination: {
        page,
        limit,
        total,
      },
    };
  }

  private toCategoryResponse(
    category: Category,
  ): CategoryResponse {
    return {
      id: String(category.id),
      name: category.name,
      slug: category.slug,
      parentId:
        category.parentId === null
          ? null
          : String(category.parentId),
      isVisible: category.isActive,
      version: category.version,
    };
  }

  /**
   * Ngăn tạo chu trình danh mục cha/con.
   */
  private async assertValidParent(
    tx: Prisma.TransactionClient,
    categoryId: number,
    parentId: number,
  ): Promise<void> {
    const visited = new Set<number>();

    let currentId: number | null = parentId;

    while (currentId !== null) {
      if (
        currentId === categoryId ||
        visited.has(currentId)
      ) {
        throw this.conflict(
          'Quan hệ danh mục cha/con tạo thành chu trình.',
        );
      }

      visited.add(currentId);

      const current: {
        id: number;
        parentId: number | null;
      } | null = await tx.category.findUnique({
        where: {
          id: currentId,
        },
        select: {
          id: true,
          parentId: true,
        },
      });

      if (!current) {
        throw new NotFoundException(
          apiErrorPayload(
            ErrorCode.NOT_FOUND,
            'Danh mục cha không tồn tại.',
          ),
        );
      }

      currentId = current.parentId;
    }
  }

  /**
   * Chỉ ADMIN và STAFF được quản lý danh mục.
   */
  private assertManagementRole(
    requester: CategoryRequester,
  ): void {
    if (
      requester.role !== UserRole.ADMIN &&
      requester.role !== UserRole.STAFF
    ) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          'Bạn không có quyền quản lý danh mục.',
        ),
      );
    }
  }

  /**
   * Chuyển ID chuỗi thành Int hợp lệ của MySQL.
   */
  private parseCategoryId(
    value: string,
  ): number {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID không đúng định dạng.',
        ),
      );
    }

    const id = Number(value);

    if (
      !Number.isSafeInteger(id) ||
      id > 2147483647
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'ID vượt phạm vi cho phép.',
        ),
      );
    }

    return id;
  }

  /**
   * If-Match chấp nhận version dạng 2 hoặc "2".
   */
  private parseIfMatch(
    value: string | undefined,
  ): number {
    if (!value) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Thiếu header If-Match.',
        ),
      );
    }

    const match =
      /^(?:"([1-9][0-9]*)"|([1-9][0-9]*))$/.exec(
        value.trim(),
      );

    if (!match) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'If-Match phải chứa version hợp lệ.',
        ),
      );
    }

    const version = Number(
      match[1] ?? match[2],
    );

    if (!Number.isSafeInteger(version) || version > 2147483647) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Version trong If-Match không hợp lệ.',
        ),
      );
    }

    return version;
  }

  /**
   * Trả lỗi xung đột theo chuẩn API chung.
   */
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

  /**
   * Ánh xạ lỗi Prisma sang HTTP 409.
   */
  private handleDatabaseConflict(
    error: unknown,
  ): void {
    if (
      error instanceof
      Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === 'P2002') {
        throw this.conflict(
          'Dữ liệu danh mục bị trùng.',
        );
      }

      if (error.code === 'P2003') {
        throw this.conflict(
          'Danh mục đang có dữ liệu tham chiếu.',
        );
      }

      if (error.code === 'P2034') {
        throw this.conflict(
          'Có giao dịch đồng thời. Vui lòng thử lại.',
        );
      }
    }
  }
}
