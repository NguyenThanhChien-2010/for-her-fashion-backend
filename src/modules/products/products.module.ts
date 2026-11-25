
import { Module } from '@nestjs/common';

import { ProductsService } from './products.service';
import { AdminProductsController } from './admin-products.controller';

import { PublicProductsService } from './public-products.service';
import { PublicProductsController } from './public-products.controller';

import { PublicProductsFiltersService } from './public-products-filters.service';

@Module({
  controllers: [
    AdminProductsController,
    PublicProductsController,
  ],
  providers: [
    ProductsService,
    PublicProductsService,
    PublicProductsFiltersService,
  ],
  exports: [
    ProductsService,
    PublicProductsService,
    PublicProductsFiltersService,
  ],
})
export class ProductsModule {}
