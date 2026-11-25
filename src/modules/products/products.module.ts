
import { Module } from '@nestjs/common';

import { ProductsService } from './products.service';
import { AdminProductsController } from './admin-products.controller';

import { PublicProductsService } from './public-products.service';
import { PublicProductsController } from './public-products.controller';

@Module({
  controllers: [
    AdminProductsController,
    PublicProductsController,
  ],
  providers: [
    ProductsService,
    PublicProductsService,
  ],
  exports: [
    ProductsService,
    PublicProductsService,
  ],
})
export class ProductsModule {}
