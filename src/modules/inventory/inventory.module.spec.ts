import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryModule } from './inventory.module';
import { InventoryLedgerService } from './inventory-ledger.service';
import { OrderInventoryService } from './order-inventory.service';

describe('InventoryModule - dependency injection', () => {
  const consumerToken = 'M03_TEST_CONSUMER';

  let moduleRef: TestingModule;

  const prismaMock = {
    productVariant: {
      findMany: jest.fn(),
    },

    $connect: jest.fn(),

    $disconnect: jest.fn(),

    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaMock.productVariant.findMany.mockResolvedValue([
      {
        id: 5,
        inventory: {
          quantity: 10,
        },
      },
    ]);

    moduleRef = await Test.createTestingModule({
      imports: [InventoryModule],

      providers: [
        {
          provide: consumerToken,

          inject: [OrderInventoryService],

          useFactory: (
            service: OrderInventoryService,
          ) => service,
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
  });

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('DI-01: resolves OrderInventoryService from InventoryModule', () => {
    const service = moduleRef
      .select(InventoryModule)
      .get(OrderInventoryService, {
        strict: true,
      });

    expect(service).toBeInstanceOf(
      OrderInventoryService,
    );

    expect(typeof service.assertAvailable)
      .toBe('function');

    expect(typeof service.deductForOrder)
      .toBe('function');

    expect(typeof service.releaseForOrder)
      .toBe('function');
  });

  it('DI-02: exports OrderInventoryService to an importing consumer', () => {
    const internalService = moduleRef
      .select(InventoryModule)
      .get(OrderInventoryService, {
        strict: true,
      });

    const consumer =
      moduleRef.get<OrderInventoryService>(
        consumerToken,
        {
          strict: false,
        },
      );

    expect(consumer).toBe(internalService);

    expect(consumer).toBeInstanceOf(
      OrderInventoryService,
    );
  });

  it('DI-03: resolves the real InventoryLedgerService', () => {
    const ledger = moduleRef
      .select(InventoryModule)
      .get(InventoryLedgerService, {
        strict: true,
      });

    expect(ledger).toBeInstanceOf(
      InventoryLedgerService,
    );

    expect(typeof ledger.findRecordedOperation)
      .toBe('function');

    expect(typeof ledger.appendPendingMovement)
      .toBe('function');
  });

  it('DI-04: uses the mocked PrismaService without connecting to MySQL', async () => {
    const service = moduleRef
      .select(InventoryModule)
      .get(OrderInventoryService, {
        strict: true,
      });

    expect(
      moduleRef.get(PrismaService),
    ).toBe(prismaMock);

    await expect(
      service.assertAvailable([
        {
          variantId: 5,
          quantity: 3,
        },
      ]),
    ).resolves.toBeUndefined();

    expect(
      prismaMock.productVariant.findMany,
    ).toHaveBeenCalledTimes(1);

    expect(
      prismaMock.$connect,
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.$transaction,
    ).not.toHaveBeenCalled();
  });
});
