
import { HttpException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';

import { ProductsService } from './products.service';
import { ProductCreateDto } from './dto/product-create.dto';
import { ProductPatchDto } from './dto/product-patch.dto';

describe('BE-02 ProductsService', () => {
  const admin = { id: 1, role: UserRole.ADMIN };
  const staff = { id: 2, role: UserRole.STAFF };

  const makeProduct = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 1,
    categoryId: 4,
    name: 'Áo sơ mi nữ',
    slug: 'ao-so-mi-nu',
    baseCode: 'ASM-001',
    description: 'Sản phẩm kiểm thử',
    price: new Prisma.Decimal(350000),
    status: 'ACTIVE',
    version: 2,
    images: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    sizeChartId: null,
    ...overrides,
  });

  // Sản phẩm không có dữ liệu liên kết, có thể xóa.
  const makeDeletableProduct = (
    overrides: Record<string, unknown> = {},
  ) =>
    makeProduct({
      _count: {
        variants: 0,
        images: 0,
        wishlist: 0,
        reviews: 0,
      },
      ratingStats: null,
      ...overrides,
    });

  // ==========================================
  // PRISMA MOCK
  // ==========================================

  const tx = {
    product: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },

    productVariant: {
      count: jest.fn(),
    },

    productImage: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },

    category: {
      findUnique: jest.fn(),
    },

    file: {
      count: jest.fn(),
    },

    auditLog: {
      create: jest.fn(),
    },
  };

  // Hỗ trợ cả interactive transaction
  // và transaction dạng mảng Promise.
  const transaction = jest.fn(
    async (
      input:
        | ((client: typeof tx) => Promise<unknown>)
        | Promise<unknown>[],
    ): Promise<unknown> => {
      if (typeof input === 'function') {
        return input(tx);
      }

      return Promise.all(input);
    },
  );

  const prisma = {
    ...tx,
    $transaction: transaction,
  };

  const idempotency = {
    execute: jest.fn(
      async (
        _subject: string,
        _key: string,
        _scope: string,
        callback: (
          client: typeof tx,
        ) => Promise<{
          statusCode: number;
          data: unknown;
        }>,
      ): Promise<unknown> => {
        const result = await callback(tx);
        return result.data;
      },
    ),
  };

  let service: ProductsService;

  beforeEach(() => {
    jest.clearAllMocks();

    tx.product.findMany.mockResolvedValue([]);
    tx.product.count.mockResolvedValue(0);

    tx.product.findUnique.mockResolvedValue(
      makeProduct(),
    );

    tx.product.findUniqueOrThrow.mockResolvedValue(
      makeProduct({ version: 3 }),
    );

    tx.product.findFirst.mockResolvedValue(null);

    tx.product.create.mockResolvedValue(
      makeProduct({ version: 1 }),
    );

    tx.product.updateMany.mockResolvedValue({
      count: 1,
    });

    // Mock dành cho DELETE.
    tx.product.deleteMany.mockResolvedValue({
      count: 1,
    });

    tx.productVariant.count.mockResolvedValue(0);

    tx.category.findUnique.mockResolvedValue({
      id: 4,
    });

    tx.file.count.mockResolvedValue(0);

    tx.productImage.deleteMany.mockResolvedValue({
      count: 0,
    });

    tx.productImage.createMany.mockResolvedValue({
      count: 0,
    });

    tx.auditLog.create.mockResolvedValue({
      id: 1n,
    });

    service = new ProductsService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
    );
  });

  const createDto: ProductCreateDto = {
    name: 'Áo sơ mi nữ',
    slug: 'ao-so-mi-nu',
    baseCode: 'ASM-001',
    categoryId: '4',
    price: 350000,
    description: 'Sản phẩm kiểm thử',
    imageFileIds: [],
    status: 'ACTIVE',
  };

  // ==========================================
  // GET PRODUCTS TESTS
  // ==========================================

  it('GET admin trả danh sách và pagination', async () => {
    const result = await service.listAdmin(1, 20);

    expect(result).toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });
  });

  it('GET admin từ chối limit lớn hơn 100', async () => {
    await expect(
      service.listAdmin(1, 101),
    ).rejects.toBeInstanceOf(HttpException);
  });

  // ==========================================
  // POST PRODUCTS TESTS
  // ==========================================

  it('ADMIN được tạo sản phẩm và ghi AuditLog', async () => {
    const result = await service.create(
      createDto,
      'be02-unit-product-create-0001',
      admin,
    );

    expect(result.id).toBe('1');
    expect(result.price).toBe(350000);

    expect(tx.product.create).toHaveBeenCalledTimes(1);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1,
        action: 'PRODUCT_CREATE',
        entityType: 'Product',
      }),
    });
  });

  it('STAFF không được tạo sản phẩm', async () => {
    await expect(
      service.create(
        createDto,
        'be02-unit-product-create-0002',
        staff,
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it('Tạo sản phẩm trùng slug hoặc baseCode trả 409', async () => {
    tx.product.findFirst.mockResolvedValue({
      id: 10,
    });

    await expect(
      service.create(
        createDto,
        'be02-unit-product-create-0003',
        admin,
      ),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(tx.product.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // PATCH PRODUCTS TESTS
  // ==========================================

  it('STAFF sửa giá bị từ chối 403', async () => {
    const dto = {
      version: 2,
      price: 200000,
    } as ProductPatchDto;

    await expect(
      service.update('1', dto, staff),
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(
      tx.product.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('STAFF được sửa tên và mô tả', async () => {
    const dto = {
      version: 2,
      name: 'Áo sơ mi STAFF cập nhật',
      description: 'Mô tả mới',
    } as ProductPatchDto;

    const result = await service.update(
      '1',
      dto,
      staff,
    );

    expect(result.version).toBe(3);

    expect(
      tx.product.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 1,
          version: 2,
        },
        data: expect.objectContaining({
          name: 'Áo sơ mi STAFF cập nhật',
          description: 'Mô tả mới',
        }),
      }),
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 2,
        action: 'PRODUCT_UPDATE',
      }),
    });
  });

  it('PATCH bằng version cũ trả 409', async () => {
    const dto = {
      version: 1,
      name: 'Tên mới',
    } as ProductPatchDto;

    await expect(
      service.update('1', dto, admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('PATCH chỉ có version bị từ chối 400', async () => {
    const dto = {
      version: 2,
    } as ProductPatchDto;

    await expect(
      service.update('1', dto, admin),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      tx.product.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('ADMIN cập nhật DISCONTINUED thành công', async () => {
    tx.product.findUniqueOrThrow.mockResolvedValue(
      makeProduct({
        status: 'DISCONTINUED',
        version: 3,
      }),
    );

    const dto = {
      version: 2,
      status: 'DISCONTINUED',
    } as ProductPatchDto;

    const result = await service.update(
      '1',
      dto,
      admin,
    );

    expect(result.status).toBe('DISCONTINUED');
    expect(result.version).toBe(3);

    expect(
      tx.product.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DISCONTINUED',
        }),
      }),
    );
  });

  it('Không cho đổi baseCode khi đã có biến thể', async () => {
    tx.productVariant.count.mockResolvedValue(1);

    const dto = {
      version: 2,
      baseCode: 'ASM-NEW',
    } as ProductPatchDto;

    await expect(
      service.update('1', dto, admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('PATCH bị xung đột version khi cập nhật đồng thời', async () => {
    tx.product.updateMany.mockResolvedValue({
      count: 0,
    });

    const dto = {
      version: 2,
      name: 'Cập nhật đồng thời',
    } as ProductPatchDto;

    await expect(
      service.update('1', dto, admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.auditLog.create,
    ).not.toHaveBeenCalled();
  });

  // ==========================================
  // DELETE PRODUCTS TESTS
  // ==========================================

  it('DELETE: STAFF không được xóa sản phẩm', async () => {
    await expect(
      service.remove('1', '"2"', staff),
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(
      tx.product.findUnique,
    ).not.toHaveBeenCalled();

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();

    expect(
      tx.auditLog.create,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: thiếu If-Match trả 400', async () => {
    await expect(
      service.remove('1', undefined, admin),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: If-Match sai định dạng trả 400', async () => {
    await expect(
      service.remove('1', '2', admin),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: sản phẩm không tồn tại trả 404', async () => {
    tx.product.findUnique.mockResolvedValue(null);

    await expect(
      service.remove('999999', '"1"', admin),
    ).rejects.toMatchObject({
      status: 404,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: version không khớp trả 409', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct(),
    );

    await expect(
      service.remove('1', '"999"', admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: sản phẩm có SKU không được xóa', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct({
        _count: {
          variants: 1,
          images: 0,
          wishlist: 0,
          reviews: 0,
        },
      }),
    );

    await expect(
      service.remove('1', '"2"', admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: sản phẩm có ảnh không được xóa', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct({
        _count: {
          variants: 0,
          images: 1,
          wishlist: 0,
          reviews: 0,
        },
      }),
    );

    await expect(
      service.remove('1', '"2"', admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: sản phẩm có đánh giá không được xóa', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct({
        _count: {
          variants: 0,
          images: 0,
          wishlist: 0,
          reviews: 1,
        },
      }),
    );

    await expect(
      service.remove('1', '"2"', admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: sản phẩm có wishlist không được xóa', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct({
        _count: {
          variants: 0,
          images: 0,
          wishlist: 1,
          reviews: 0,
        },
      }),
    );

    await expect(
      service.remove('1', '"2"', admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: sản phẩm có ratingStats không được xóa', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct({
        ratingStats: {
          productId: 1,
        },
      }),
    );

    await expect(
      service.remove('1', '"2"', admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.product.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('DELETE: ADMIN xóa thành công và ghi AuditLog', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct(),
    );

    await expect(
      service.remove('1', '"2"', admin),
    ).resolves.toBeUndefined();

    expect(
      tx.product.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 1,
        version: 2,
      },
    });

    expect(
      tx.auditLog.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1,
        action: 'PRODUCT_DELETE',
        entityType: 'Product',
        entityId: '1',
        before: expect.objectContaining({
          name: 'Áo sơ mi nữ',
          version: 2,
        }),
        after: {
          deleted: true,
        },
      }),
    });

    expect(
      transaction,
    ).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('DELETE: xung đột khi deleteMany trả count 0', async () => {
    tx.product.findUnique.mockResolvedValue(
      makeDeletableProduct(),
    );

    tx.product.deleteMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.remove('1', '"2"', admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(
      tx.auditLog.create,
    ).not.toHaveBeenCalled();
  });
});
