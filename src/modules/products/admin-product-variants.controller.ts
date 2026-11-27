
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { VariantCreateDto } from './dto/variant-create.dto';
import { ProductRequester } from './products.service';
import { ProductVariantsService } from './product-variants.service';

@ApiTags('M02')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/products/:productId/variants')
export class AdminProductVariantsController {
  constructor(
    private readonly variantsService: ProductVariantsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo biến thể với SKU do server sinh',
    operationId: 'm02_post_admin_products_productId_variants',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Khóa chống gửi trùng, dài 16–128 ký tự.',
  })
  @ApiBody({
    type: VariantCreateDto,
  })
  @ApiCreatedResponse({
    description: 'Tạo biến thể thành công.',
  })
  create(
    @Param('productId') productId: string,
    @Body() dto: VariantCreateDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() requester: ProductRequester,
  ) {
    return this.variantsService.create(
      productId,
      dto,
      idempotencyKey,
      requester,
    );
  }
}
