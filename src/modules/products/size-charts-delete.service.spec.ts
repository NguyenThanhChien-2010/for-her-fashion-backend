import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { SizeChartsService } from './size-charts.service';

// BE-02 / M02 - DELETE SizeChart Service Unit Tests
// All database interactions are mocked; no real MySQL data is modified.
describe('BE-02 SizeChartsService - DELETE', () => {
  const unlinkedChart = {
    id: 7,
    version: 4,
    products: [],
    categories: [],
  };

  const tx = {
    $queryRaw: jest.fn(),
    sizeChart: {
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(),
  };

  const idempotency = {
    execute: jest.fn(),
  };

  let service: SizeChartsService;

  beforeEach(() => {
    jest.resetAllMocks();

    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    tx.sizeChart.findUnique.mockResolvedValue({ ...unlinkedChart });
    tx.sizeChart.deleteMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    service = new SizeChartsService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
    );
  });

  it('1. Xoa bang khong lien ket, If-Match dung - Promise<void>', async () => {
    await expect(service.remove('7', '"4"')).resolves.toBeUndefined();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.sizeChart.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.sizeChart.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.sizeChart.deleteMany.mock.invocationCallOrder[0],
    );
    expect(tx.sizeChart.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: {
        id: true,
        version: true,
        products: { select: { id: true } },
        categories: { select: { id: true } },
      },
    });
    expect(tx.sizeChart.deleteMany).toHaveBeenCalledWith({
      where: { id: 7, version: 4 },
    });
  });

  it('2. Bang con lien ket PRODUCT tra HTTP 409, khong xoa', async () => {
    tx.sizeChart.findUnique.mockResolvedValue({
      ...unlinkedChart,
      products: [{ id: 4 }],
    });

    await expect(service.remove('7', '"4"')).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('3. Bang con lien ket GROUP tra HTTP 409, khong xoa', async () => {
    tx.sizeChart.findUnique.mockResolvedValue({
      ...unlinkedChart,
      categories: [{ id: 5 }],
    });

    await expect(service.remove('7', '"4"')).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('4. If-Match cu tra HTTP 409, khong xoa', async () => {
    await expect(service.remove('7', '"3"')).rejects.toMatchObject({
      status: 409,
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('5. Thieu If-Match tra HTTP 400, khong mo transaction', async () => {
    await expect(service.remove('7')).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['4', 'W/"4"', '*', '"0"', '"-1"', '"01"', '"abc"', '"4" '])(
    '6. If-Match sai dinh dang (%s) tra HTTP 400',
    async (header) => {
      await expect(service.remove('7', header)).rejects.toMatchObject({
        status: 400,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['abc', '0', '-1', '1.5', '2147483648', '9007199254740992'])(
    '7. chartId sai (%s) tra HTTP 400',
    async (chartId) => {
      await expect(service.remove(chartId, '"4"')).rejects.toMatchObject({
        status: 400,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('8. Bang khong ton tai tra HTTP 404', async () => {
    tx.sizeChart.findUnique.mockResolvedValue(null);

    await expect(service.remove('7', '"4"')).rejects.toMatchObject({
      status: 404,
    });
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('8b. Khong tim thay chart khi khoa: HTTP 404, khong doc tiep', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(service.remove('7', '"4"')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
    expect(tx.sizeChart.findUnique).not.toHaveBeenCalled();
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('9. deleteMany count=0 tra HTTP 409 (concurrent change)', async () => {
    tx.sizeChart.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove('7', '"4"')).rejects.toMatchObject({
      status: 409,
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(tx.sizeChart.deleteMany).toHaveBeenCalledWith({
      where: { id: 7, version: 4 },
    });
  });

  it('9b. Loi khoa SQL duoc propagate, khong thuc hien DELETE', async () => {
    const lockError = new Error('Simulated SQL lock failure');
    tx.$queryRaw.mockRejectedValue(lockError);

    await expect(service.remove('7', '"4"')).rejects.toBe(lockError);
    expect(tx.sizeChart.findUnique).not.toHaveBeenCalled();
    expect(tx.sizeChart.deleteMany).not.toHaveBeenCalled();
  });

  it('10. Loi ngoai le trong transaction duoc propagate (transaction abort)', async () => {
    const dbError = new Error('Simulated database failure');
    tx.sizeChart.deleteMany.mockRejectedValue(dbError);

    await expect(service.remove('7', '"4"')).rejects.toBe(dbError);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('11. Ma loi P2003 duoc chuyen thanh HTTP 409', async () => {
    tx.sizeChart.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK constraint', {
        code: 'P2003',
        clientVersion: '6.19.3',
      }),
    );

    await expect(service.remove('7', '"4"')).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });
  });

  it('12. Ma loi P2034 duoc chuyen thanh HTTP 409', async () => {
    tx.sizeChart.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Write conflict', {
        code: 'P2034',
        clientVersion: '6.19.3',
      }),
    );

    await expect(service.remove('7', '"4"')).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });
  });

  it('13. If-Match vuot gioi han Int32 tra HTTP 400', async () => {
    await expect(service.remove('7', '"2147483648"')).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('14. If-Match vuot gioi han so nguyen an toan tra HTTP 400', async () => {
    await expect(
      service.remove('7', '"9007199254740992"'),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
