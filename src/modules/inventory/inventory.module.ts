import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { InventoryService } from './inventory.service';
import { PublicInventoryController } from './public-inventory.controller';

import { AdminInventoryService } from './admin-inventory.service';
import { InventoryMovementService } from './inventory-movement.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { OrderInventoryService } from './order-inventory.service';
import { ReturnInventoryService } from './return-inventory.service';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { AdminInventoryAdjustmentController } from './admin-inventory-adjustment.controller';
import { PendingInventoryEffectService } from './pending-inventory-effect.service';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { AdminInventoryController } from './admin-inventory.controller';

@Module({
  imports: [PrismaModule],

  controllers: [
    PublicInventoryController,
    AdminInventoryController,
    AdminInventoryAdjustmentController,
  ],

  providers: [
    InventoryService,
    AdminInventoryService,
    InventoryMovementService,
    InventoryLedgerService,
    InventoryAdjustmentService,
    PendingInventoryEffectService,
    InventoryReconciliationService,
    OrderInventoryService,
    ReturnInventoryService,
  ],

  exports: [
    InventoryService,
    OrderInventoryService,
    ReturnInventoryService,
  ],
})
export class InventoryModule {}
