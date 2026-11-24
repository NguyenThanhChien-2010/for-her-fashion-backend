
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Category, UserRole } from '@prisma/client';

import { CategoriesService } from './categories.service';

function categoryRow(
  overrides: Partial<Category> = {},
): Category {
  return {
    id: 2,
    name: 'Váy thời trang nữ',
    slug: 'vay-thoi-trang-nu',
    parentId: null,
    sizeChartId: null,
    sortOrder: 0,
    isActive: true,
    version: 2,
    ...overrides,
  } as Category;
}

function deps() {
  const tx = {
    category: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(
        categoryRow({ version: 3 }),
      ),
      create: jest.fn().mockResolvedValue(
        categoryRow({
          id: 5,
          name: 'Danh mục mới',
          slug: 'danh-muc-moi',
          version: 1,
        }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    product: {
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 10 }),
    },
  };

  const prisma = {
    category: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(
      async (
        fn: (client: typeof tx) => Promise<unknown>,
      ) => fn(tx),
    ),
  };

  const idempotency = {
    execute: jest.fn(
      async (
        _subject: string,
        _key: string,
        _scope: string,
        fn: (
          transaction: typeof tx,
        ) => Promise<{
          statusCode: number;
          data: unknown;
        }>,
      ) => (await fn(tx)).data,
    ),
  };

  return {
    tx,
    prisma,
    idempotency,
    service: new CategoriesService(
      prisma as never,
      idempotency as never,
    ),
  };
}

const admin = {
  id: 1,
  role: UserRole.ADMIN,
};

const staff = {
  id: 2,
  role: UserRole.STAFF,
};

const customer = {
  id: 3,
  role: UserRole.CUSTOMER,
};

describe('CategoriesService', () => {
  describe('GET Categories', () => {
    it('chỉ lấy danh mục đang hiển thị ở Public', async () => {
      const d = deps();

      await d.service.listPublic({
        page: 1,
        limit: 20,
      });

      expect(d.prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );

      expect(d.prisma.category.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it('Admin có thể lấy cả danh mục đang ẩn', async () => {
      const d = deps();

      await d.service.listAdmin({
        page: 1,
        limit: 20,
      });

      expect(d.prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('trả về phân trang và định dạng ID theo API', async () => {
      const d = deps();

      d.prisma.category.findMany.mockResolvedValue([
        categoryRow(),
      ]);
      d.prisma.category.count.mockResolvedValue(1);

      const result = await d.service.listPublic({
        page: 2,
        limit: 10,
      });

      expect(result).toEqual({
        items: [
          {
            id: '2',
            name: 'Váy thời trang nữ',
            slug: 'vay-thoi-trang-nu',
            parentId: null,
            isVisible: true,
            version: 2,
          },
        ],
        pagination: {
          page: 2,
          limit: 10,
          total: 1,
        },
      });

      expect(d.prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('POST Categories', () => {
    const createDto = {
      name: 'Danh mục mới',
      slug: 'danh-muc-moi',
      parentId: null,
      isVisible: true,
    };

    it('Admin tạo danh mục và ghi AuditLog', async () => {
      const d = deps();

      const result = await d.service.create(
        createDto,
        'be02-unit-create-0001',
        admin,
      );

      expect(result.id).toBe('5');
      expect(result.version).toBe(1);

      expect(d.tx.category.create).toHaveBeenCalledWith({
        data: {
          name: 'Danh mục mới',
          slug: 'danh-muc-moi',
          parentId: null,
          isActive: true,
        },
      });

      expect(d.tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 1,
          action: 'CATEGORY_CREATE',
          entityType: 'Category',
          entityId: '5',
        }),
      });
    });

    it('chuyển user ID sang string cho IdempotencyService', async () => {
      const d = deps();

      await d.service.create(
        createDto,
        'be02-unit-create-0002',
        admin,
      );

      expect(d.idempotency.execute).toHaveBeenCalledWith(
        '1',
        'be02-unit-create-0002',
        'admin.categories.create',
        expect.any(Function),
      );
    });

    it('Staff được phép tạo danh mục', async () => {
      const d = deps();

      await d.service.create(
        createDto,
        'be02-unit-create-0003',
        staff,
      );

      expect(d.tx.category.create).toHaveBeenCalledTimes(1);
      expect(d.tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 2,
        }),
      });
    });

    it('Customer không được tạo danh mục', async () => {
      const d = deps();

      await expect(
        d.service.create(
          createDto,
          'be02-unit-create-0004',
          customer,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(d.idempotency.execute).not.toHaveBeenCalled();
    });

    it('từ chối slug đã tồn tại', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue({
        id: 99,
      });

      await expect(
        d.service.create(
          createDto,
          'be02-unit-create-0005',
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(d.tx.category.create).not.toHaveBeenCalled();
    });

    it('từ chối danh mục cha không tồn tại', async () => {
      const d = deps();

      await expect(
        d.service.create(
          {
            ...createDto,
            parentId: '999',
          },
          'be02-unit-create-0006',
          admin,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('PATCH Categories', () => {
    it('cập nhật danh mục và tăng version', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue(
        categoryRow(),
      );

      const result = await d.service.update(
        '2',
        {
          version: 2,
          name: 'Váy mới',
        },
        admin,
      );

      expect(d.tx.category.updateMany).toHaveBeenCalledWith({
        where: {
          id: 2,
          version: 2,
        },
        data: {
          version: { increment: 1 },
          name: 'Váy mới',
        },
      });

      expect(result.version).toBe(3);

      expect(d.tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 1,
          action: 'CATEGORY_UPDATE',
          entityId: '2',
        }),
      });
    });

    it('từ chối cập nhật bằng version cũ', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue(
        categoryRow({ version: 2 }),
      );

      await expect(
        d.service.update(
          '2',
          {
            version: 1,
            name: 'Tên không hợp lệ về version',
          },
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(d.tx.category.updateMany).not.toHaveBeenCalled();
      expect(d.tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('từ chối request chỉ có version', async () => {
      const d = deps();

      await expect(
        d.service.update(
          '2',
          { version: 2 },
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ngăn danh mục trở thành cha của chính nó', async () => {
      const d = deps();

      await expect(
        d.service.update(
          '2',
          {
            version: 2,
            parentId: '2',
          },
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ngăn tạo chu trình danh mục cha/con', async () => {
      const d = deps();

      d.tx.category.findUnique
        .mockResolvedValueOnce(categoryRow())
        .mockResolvedValueOnce({
          id: 3,
          parentId: 2,
        });

      await expect(
        d.service.update(
          '2',
          {
            version: 2,
            parentId: '3',
          },
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(d.tx.category.updateMany).not.toHaveBeenCalled();
    });

    it('Staff được cập nhật trạng thái hiển thị', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue(
        categoryRow(),
      );

      await d.service.update(
        '2',
        {
          version: 2,
          isVisible: false,
        },
        staff,
      );

      expect(d.tx.category.updateMany).toHaveBeenCalledWith({
        where: {
          id: 2,
          version: 2,
        },
        data: {
          version: { increment: 1 },
          isActive: false,
        },
      });
    });
  });

  describe('DELETE Categories', () => {
    it('Admin xóa danh mục không còn ràng buộc', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue(
        categoryRow(),
      );

      await d.service.remove(
        '2',
        '"2"',
        admin,
      );

      expect(d.tx.category.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 2,
          version: 2,
        },
      });

      expect(d.tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 1,
          action: 'CATEGORY_DELETE',
          entityId: '2',
        }),
      });
    });

    it('Staff không được xóa danh mục', async () => {
      const d = deps();

      await expect(
        d.service.remove(
          '2',
          '"2"',
          staff,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(d.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('từ chối xóa khi còn danh mục con', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue(
        categoryRow(),
      );
      d.tx.category.count.mockResolvedValue(1);

      await expect(
        d.service.remove(
          '2',
          '"2"',
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(d.tx.category.deleteMany).not.toHaveBeenCalled();
    });

    it('từ chối xóa khi còn sản phẩm', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue(
        categoryRow(),
      );
      d.tx.product.count.mockResolvedValue(1);

      await expect(
        d.service.remove(
          '2',
          '"2"',
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(d.tx.category.deleteMany).not.toHaveBeenCalled();
    });

    it('từ chối xóa khi If-Match không khớp', async () => {
      const d = deps();

      d.tx.category.findUnique.mockResolvedValue(
        categoryRow({ version: 2 }),
      );

      await expect(
        d.service.remove(
          '2',
          '"1"',
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(d.tx.category.deleteMany).not.toHaveBeenCalled();
    });
  });
});
