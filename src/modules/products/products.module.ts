
import { Module } from '@nestjs/common';

import { ProductsService } from './products.service';
import { AdminProductsController } from './admin-products.controller';

import { PublicProductsService } from './public-products.service';
import { PublicProductsController } from './public-products.controller';

import { PublicProductsFiltersService } from './public-products-filters.service';

import { ProductOptionsService } from './product-options.service';

import {
  AdminColorsController,
  AdminSizesController,
} from './admin-product-options.controller';

import { ProductVariantsService } from './product-variants.service';
import { AdminProductVariantsController } from './admin-product-variants.controller';

@Module({
  controllers: [
    AdminProductsController,
    PublicProductsController,
    AdminColorsController,
    AdminSizesController,
    AdminProductVariantsController,
  ],

  providers: [
    ProductsService,
    PublicProductsService,
    PublicProductsFiltersService,
    ProductOptionsService,
    ProductVariantsService,
  ],

  exports: [
    ProductsService,
    PublicProductsService,
    PublicProductsFiltersService,
    ProductOptionsService,
    ProductVariantsService,
  ],
})
export class ProductsModule {}
