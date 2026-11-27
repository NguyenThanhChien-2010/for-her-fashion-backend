import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryModule } from './inventory.module';
import { InventoryLedgerService } from './inventory-ledger.service';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { OrderInventoryService } from './order-inventory.service';
import { ReturnInventoryService } from './return-inventory.service';

describe('InventoryModule - return inventory dependency injection', () => {
  const consumerToken = 'M03_RETURN_TEST_CONSUMER';
  let moduleRef: TestingModule;

  const prismaMock = {
    $queryRaw: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      imports: [InventoryModule],
      providers: [
        {
          provide: consumerToken,
          inject: [ReturnInventoryService, OrderInventoryService],
          useFactory: (
            returns: ReturnInventoryService,
            orders: OrderInventoryService,
          ) => ({ returns, orders }),
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

  it('RDI-01: resolves ReturnInventoryService inside InventoryModule', () => {
    const service = moduleRef.select(InventoryModule).get(
      ReturnInventoryService,
      { strict: true },
    );
    expect(service).toBeInstanceOf(ReturnInventoryService);
    expect(typeof service.prepareReceipt).toBe('function');
    expect(typeof service.applyVerifiedReturn).toBe('function');
    expect(typeof service.validateNonResalableReturn).toBe('function');
  });

  it('RDI-02: exports the same return service to an importing consumer', () => {
    const consumer = moduleRef.get<{
      returns: ReturnInventoryService;
      orders: OrderInventoryService;
    }>(consumerToken, { strict: false });
    expect(consumer.returns).toBe(
      moduleRef.select(InventoryModule).get(ReturnInventoryService, {
        strict: true,
      }),
    );
  });

  it('RDI-03: injects the real ledger and pending effect providers', () => {
    const inventory = moduleRef.select(InventoryModule);
    const service = inventory.get(ReturnInventoryService, { strict: true });
    const ledger = inventory.get(InventoryLedgerService, { strict: true });
    const pending = inventory.get(PendingInventoryEffectService, {
      strict: true,
    });
    expect(ledger).toBeInstanceOf(InventoryLedgerService);
    expect(pending).toBeInstanceOf(PendingInventoryEffectService);
    expect(service).toHaveProperty('ledger', ledger);
    expect(service).toHaveProperty('pendingEffects', pending);
  });

  it('RDI-04: preserves OrderInventoryService export for existing consumers', () => {
    const consumer = moduleRef.get<{
      returns: ReturnInventoryService;
      orders: OrderInventoryService;
    }>(consumerToken, { strict: false });
    expect(consumer.orders).toBeInstanceOf(OrderInventoryService);
    expect(consumer.orders).toBe(
      moduleRef.select(InventoryModule).get(OrderInventoryService, {
        strict: true,
      }),
    );
  });

  it('RDI-05: validates invalid receipt without starting a database transaction', async () => {
    const service = moduleRef.select(InventoryModule).get(
      ReturnInventoryService,
      { strict: true },
    );
    expect(moduleRef.get(PrismaService)).toBe(prismaMock);
    await expect(
      service.prepareReceipt(
        prismaMock as unknown as Prisma.TransactionClient,
        'CUSTOMER_RETURN',
        0,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.$connect).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
