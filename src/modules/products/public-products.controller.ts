
import {
  Controller,
  Get,
  Param,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { PublicProductsService } from './public-products.service';

@ApiTags('M02')
@Public()
@Controller('products')
export class PublicProductsController {
  constructor(
    private readonly publicProductsService: PublicProductsService,
  ) {}

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
    example: '2',
  })
  @ApiOkResponse({
    description: 'Chi tiết sản phẩm công khai.',
  })
  @ApiBadRequestResponse({
    description: 'ID sản phẩm không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Sản phẩm không tồn tại hoặc không hiển thị.',
  })
  findOne(
    @Param('productId') productId: string,
  ) {
    return this.publicProductsService.findOne(productId);
  }
}
