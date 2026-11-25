
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

  const tx = {
    product: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
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
        ) => Promise<{ statusCode: number; data: unknown }>,
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
    tx.product.findUnique.mockResolvedValue(makeProduct());
    tx.product.findUniqueOrThrow.mockResolvedValue(
      makeProduct({ version: 3 }),
    );
    tx.product.findFirst.mockResolvedValue(null);
    tx.product.create.mockResolvedValue(
      makeProduct({ version: 1 }),
    );
    tx.product.updateMany.mockResolvedValue({ count: 1 });

    tx.productVariant.count.mockResolvedValue(0);
    tx.category.findUnique.mockResolvedValue({ id: 4 });
    tx.file.count.mockResolvedValue(0);

    tx.productImage.deleteMany.mockResolvedValue({ count: 0 });
    tx.productImage.createMany.mockResolvedValue({ count: 0 });
    tx.auditLog.create.mockResolvedValue({ id: 1n });

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
    await expect(service.listAdmin(1, 101)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

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
    tx.product.findFirst.mockResolvedValue({ id: 10 });

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

    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('STAFF được sửa tên và mô tả', async () => {
    const dto = {
      version: 2,
      name: 'Áo sơ mi STAFF cập nhật',
      description: 'Mô tả mới',
    } as ProductPatchDto;

    const result = await service.update('1', dto, staff);

    expect(result.version).toBe(3);

    expect(tx.product.updateMany).toHaveBeenCalledWith(
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

    expect(tx.product.updateMany).not.toHaveBeenCalled();
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

    expect(tx.product.updateMany).not.toHaveBeenCalled();
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

    const result = await service.update('1', dto, admin);

    expect(result.status).toBe('DISCONTINUED');
    expect(result.version).toBe(3);

    expect(tx.product.updateMany).toHaveBeenCalledWith(
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

    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('PATCH bị xung đột version khi cập nhật đồng thời', async () => {
    tx.product.updateMany.mockResolvedValue({ count: 0 });

    const dto = {
      version: 2,
      name: 'Cập nhật đồng thời',
    } as ProductPatchDto;

    await expect(
      service.update('1', dto, admin),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
