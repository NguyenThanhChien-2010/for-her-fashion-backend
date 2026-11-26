
import { Prisma, UserRole } from '@prisma/client';

import { ProductVariantsService } from './product-variants.service';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';

describe('BE-02 ProductVariantsService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    product: {
      findUnique: jest.fn(),
    },
    color: {
      findUnique: jest.fn(),
    },
    size: {
      findUnique: jest.fn(),
    },
    productVariant: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    inventory: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const idempotency = {
    execute: jest.fn(),
  };

  let service: ProductVariantsService;

  const admin = {
    id: 1,
    role: UserRole.ADMIN,
  };

  const staff = {
    id: 2,
    role: UserRole.STAFF,
  };

  const input = {
    colorId: '1',
    sizeCode: 'M',
  };

  beforeEach(() => {
    jest.resetAllMocks();

    tx.$queryRaw.mockResolvedValue([{ baseCode: 'AD10005' }]);
    tx.product.findUnique.mockResolvedValue({
      id: 3,
      baseCode: 'AD10005',
    });

    tx.color.findUnique.mockResolvedValue({
      id: 1,
      skuSuffix: 'B02RED',
    });

    tx.size.findUnique.mockResolvedValue({
      code: 'M',
      skuSuffix: 'BE02M',
      isActive: true,
    });

    tx.productVariant.findFirst.mockResolvedValue(null);

    tx.productVariant.create.mockResolvedValue({
      id: 10,
      productId: 3,
      colorId: 1,
      sizeCode: 'M',
      sku: 'AD10005B02REDBE02M',
      isActive: true,
      version: 1,
    });

    tx.auditLog.create.mockResolvedValue({
      id: 1,
    });

    idempotency.execute.mockImplementation(
      async (
        _subject: string,
        _key: string,
        _scope: string,
        callback: (transaction: typeof tx) => Promise<{
          statusCode: number;
          data: unknown;
        }>,
      ) => {
        const result = await callback(tx);
        return result.data;
      },
    );

    service = new ProductVariantsService(
      {} as PrismaService,
      idempotency as unknown as IdempotencyService,
    );
  });

  const createVariant = () =>
    service.create(
      '3',
      input,
      'be02-variant-test-key-0001',
      admin,
    );

  it('1. ADMIN tạo SKU đúng công thức', async () => {
    const result = await createVariant();

    expect(result).toEqual({
      id: '10',
      productId: '3',
      colorId: '1',
      sizeCode: 'M',
      sku: 'AD10005B02REDBE02M',
      status: 'ACTIVE',
      version: 1,
    });

    expect(tx.productVariant.create).toHaveBeenCalledWith({
      data: {
        productId: 3,
        colorId: 1,
        sizeCode: 'M',
        sku: 'AD10005B02REDBE02M',
        isActive: true,
      },
    });
  });

  it('2. STAFF không được tạo SKU', async () => {
    await expect(
      service.create(
        '3',
        input,
        'be02-variant-test-key-0002',
        staff,
      ),
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('3. Product ID không hợp lệ trả 400', async () => {
    await expect(
      service.create(
        'abc',
        input,
        'be02-variant-test-key-0003',
        admin,
      ),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('4. Product không tồn tại trả 404', async () => {
    tx.product.findUnique.mockResolvedValue(null);

    await expect(createVariant()).rejects.toMatchObject({
      status: 404,
    });

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('5. Color không tồn tại trả 404', async () => {
    tx.color.findUnique.mockResolvedValue(null);

    await expect(createVariant()).rejects.toMatchObject({
      status: 404,
    });

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('6. Size không tồn tại trả 404', async () => {
    tx.size.findUnique.mockResolvedValue(null);

    await expect(createVariant()).rejects.toMatchObject({
      status: 404,
    });

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('7. Size đã ngừng sử dụng trả 400', async () => {
    tx.size.findUnique.mockResolvedValue({
      code: 'M',
      skuSuffix: 'BE02M',
      isActive: false,
    });

    await expect(createVariant()).rejects.toMatchObject({
      status: 400,
    });

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('8. SKU hoặc tổ hợp trùng trả 409', async () => {
    tx.productVariant.findFirst.mockResolvedValue({
      id: 99,
    });

    await expect(createVariant()).rejects.toMatchObject({
      status: 409,
    });

    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('9. Database unique conflict P2002 trả 409', async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.0',
      },
    );

    tx.productVariant.create.mockRejectedValue(error);

    await expect(createVariant()).rejects.toMatchObject({
      status: 409,
    });
  });

  it('10. Tạo SKU không tự ý thay đổi tồn kho', async () => {
    await createVariant();

    expect(tx.inventory.create).not.toHaveBeenCalled();
    expect(tx.inventory.update).not.toHaveBeenCalled();

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PRODUCT_VARIANT_CREATE',
        entityType: 'ProductVariant',
        entityId: '10',
      }),
    });

    expect(idempotency.execute).toHaveBeenCalledWith(
      '1',
      'be02-variant-test-key-0001',
      'admin.products.variants.create',
      expect.any(Function),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });
});
