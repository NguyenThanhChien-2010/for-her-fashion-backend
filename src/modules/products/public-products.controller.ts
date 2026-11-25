
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';

import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';

import {
  apiErrorPayload,
  ErrorCode,
} from '../../common/errors/api-error';

import {
  PublicProductsQuery,
  PublicProductsService,
} from './public-products.service';

import {
  PublicProductsFiltersService,
} from './public-products-filters.service';

@ApiTags('M02')
@Public()
@Controller('products')
export class PublicProductsController {
  constructor(
    private readonly publicProductsService:
      PublicProductsService,

    private readonly filtersService:
      PublicProductsFiltersService,
  ) {}

  // ==========================================
  // GET /api/v1/products
  // ==========================================

  @Get()
  @ApiOperation({
    summary:
      'Danh sách sản phẩm công khai - tìm kiếm và lọc',
    operationId: 'm02_get_products',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
  })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    example: 'áo',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    type: String,
    example: '4',
  })
  @ApiQuery({
    name: 'colorIds',
    required: false,
    type: [String],
    style: 'form',
    explode: true,
    example: ['1', '2'],
  })
  @ApiQuery({
    name: 'sizeCodes',
    required: false,
    type: [String],
    style: 'form',
    explode: true,
    example: ['M', 'L'],
  })
  @ApiQuery({
    name: 'inStock',
    required: false,
    type: Boolean,
    example: true,
  })
  @ApiQuery({
    name: 'minPrice',
    required: false,
    type: Number,
    example: 100000,
  })
  @ApiQuery({
    name: 'maxPrice',
    required: false,
    type: Number,
    example: 500000,
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: [
      'NEWEST',
      'PRICE_ASC',
      'PRICE_DESC',
    ],
    description:
      'RELEVANCE chưa triển khai vì thiếu đặc tả FR-03.4.',
  })
  @ApiOkResponse({
    description: 'Danh sách sản phẩm công khai.',
  })
  @ApiBadRequestResponse({
    description: 'Tham số không hợp lệ.',
  })
  findAll(
    @Query() query: PublicProductsQuery,
  ) {
    return this.publicProductsService.findAll(query);
  }

  // ==========================================
  // GET /api/v1/products/filters
  // ==========================================

  @Get('filters')
  @ApiOperation({
    summary: 'Lấy các giá trị bộ lọc thực có',
    operationId: 'm02_get_products_filters',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    type: String,
    example: '4',
    description:
      'Danh mục cần lấy bộ lọc. Để trống để lấy tất cả.',
  })
  @ApiOkResponse({
    description:
      'Danh sách màu, size và khoảng giá thực có.',
  })
  @ApiBadRequestResponse({
    description: 'categoryId không hợp lệ.',
  })
  getFilters(
    @Query('categoryId') categoryId?: string,
    @Query() query?: Record<string, unknown>,
  ) {
    // Endpoint chỉ chấp nhận categoryId.
    if (
      query &&
      Object.keys(query).some(
        (key) => key !== 'categoryId',
      )
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Tham số bộ lọc không hợp lệ.',
        ),
      );
    }

    return this.filtersService.getFilters(
      categoryId,
    );
  }

  // ==========================================
  // GET /api/v1/products/:productId
  // ==========================================

  @Get(':productId')
  @ApiOperation({
    summary: 'Chi tiết sản phẩm đang hiển thị',
    operationId: 'm02_get_products_productId',
  })
  @ApiParam({
    name: 'productId',
    required: true,
    description: 'ID sản phẩm dạng số nguyên dương.',
    example: '3',
  })
  @ApiOkResponse({
    description: 'Chi tiết sản phẩm công khai.',
  })
  @ApiBadRequestResponse({
    description: 'ID sản phẩm không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description:
      'Sản phẩm không tồn tại hoặc không hiển thị.',
  })
  findOne(
    @Param('productId') productId: string,
  ) {
    return this.publicProductsService.findOne(
      productId,
    );
  }
}
