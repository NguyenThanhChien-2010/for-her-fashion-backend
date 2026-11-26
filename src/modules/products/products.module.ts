
import { Module } from '@nestjs/common';

// ==========================================
// ADMIN PRODUCTS
// ==========================================

import { ProductsService } from './products.service';
import { AdminProductsController } from './admin-products.controller';

// ==========================================
// PUBLIC PRODUCTS
// ==========================================

import { PublicProductsService } from './public-products.service';
import { PublicProductsController } from './public-products.controller';

import { PublicProductsFiltersService } from './public-products-filters.service';
import { PublicProductVariantsController } from './public-product-variants.controller';
import { PublicProductVariantsService } from './public-product-variants.service';

// ==========================================
// COLORS & SIZES
// ==========================================

import { ProductOptionsService } from './product-options.service';

import {
  AdminColorsController,
  AdminSizesController,
} from './admin-product-options.controller';

// ==========================================
// PRODUCT VARIANTS / SKU
// ==========================================

import { ProductVariantsService } from './product-variants.service';
import { AdminProductVariantsController } from './admin-product-variants.controller';
import { AdminVariantsController } from './admin-variants.controller';
import { VariantPatchService } from './variant-patch.service';

// ==========================================
// ADMIN SIZE CHARTS
// ==========================================

import { SizeChartsService } from './size-charts.service';
import { AdminSizeChartsController } from './admin-size-charts.controller';

// ==========================================
// PUBLIC SIZE CHARTS
// ==========================================

import { PublicSizeChartService } from './public-size-chart.service';
import { PublicSizeChartController } from './public-size-chart.controller';

// ==========================================
// PRODUCTS MODULE
// ==========================================

@Module({
  controllers: [
    // Admin Products
    AdminProductsController,

    // Public Products
    PublicProductsController,
    PublicProductVariantsController,

    // Colors & Sizes
    AdminColorsController,
    AdminSizesController,

    // Product Variants
    AdminProductVariantsController,
    AdminVariantsController,

    // Admin Size Charts
    AdminSizeChartsController,

    // Public Size Charts
    PublicSizeChartController,
  ],

  providers: [
    // Admin Products
    ProductsService,

    // Public Products
    PublicProductsService,
    PublicProductsFiltersService,
    PublicProductVariantsService,

    // Colors & Sizes
    ProductOptionsService,

    // Product Variants
    ProductVariantsService,
    VariantPatchService,

    // Admin Size Charts
    SizeChartsService,

    // Public Size Charts
    PublicSizeChartService,
  ],

  exports: [
    ProductsService,
    PublicProductsService,
    PublicProductsFiltersService,
    ProductOptionsService,
    ProductVariantsService,
    SizeChartsService,
    PublicSizeChartService,
  ],
})
export class ProductsModule {}
