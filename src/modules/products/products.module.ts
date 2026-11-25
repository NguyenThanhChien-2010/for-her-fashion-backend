
import { Module } from '@nestjs/common';

import { ProductsService } from './products.service';
import { AdminProductsController } from './admin-products.controller';

@Module({
  controllers: [AdminProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
