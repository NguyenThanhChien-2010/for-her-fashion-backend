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
  PublicProductVariantsService,
} from './public-product-variants.service';

import type {
  PublicProductVariantsQuery,
} from './public-product-variants.service';

@ApiTags('M02')
@Public()
@Controller('products')
export class PublicProductVariantsController {
  constructor(
    private readonly variantsService: PublicProductVariantsService,
  ) {}

  @Get(':productId/variants')
  @ApiOperation({
    summary: 'Biến thể và SKU của sản phẩm',
    operationId: 'm02_get_products_productId_variants',
  })
  @ApiParam({
    name: 'productId',
    required: true,
    type: String,
    example: '3',
  })
  @ApiQuery({
    name: 'colorId',
    required: false,
    type: String,
    example: '1',
  })
  @ApiQuery({
    name: 'sizeCode',
    required: false,
    type: String,
    example: 'M',
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
  @ApiOkResponse({
    description: 'Danh sách biến thể và SKU.',
  })
  @ApiBadRequestResponse({
    description: 'Tham số không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Sản phẩm không tồn tại hoặc không hiển thị.',
  })
  findAll(
    @Param('productId') productId: string,
    @Query() query: PublicProductVariantsQuery,
  ) {
    const allowedKeys = [
      'colorId',
      'sizeCode',
      'page',
      'limit',
    ];

    if (
      Object.keys(query).some(
        (key) => !allowedKeys.includes(key),
      )
    ) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.VALIDATION_ERROR,
          'Tham số truy vấn không hợp lệ.',
        ),
      );
    }

    return this.variantsService.findAll(
      productId,
      query,
    );
  }
}