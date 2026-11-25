
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import {
  ProductsService,
  ProductRequester,
} from './products.service';
import { ProductCreateDto } from './dto/product-create.dto';
import { ProductPatchDto } from './dto/product-patch.dto';

@ApiTags('M02')
@ApiBearerAuth()
@Controller('admin/products')
@Roles(UserRole.ADMIN, UserRole.STAFF)
export class AdminProductsController {
  constructor(
    private readonly productsService: ProductsService,
  ) {}

  // ==========================================
  // GET /api/v1/admin/products
  // ==========================================

  @Get()
  @ApiOperation({
    summary: 'Danh sách sản phẩm quản trị',
  })
  @ApiOkResponse({
    description: 'Danh sách sản phẩm có phân trang.',
  })
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.listAdmin(
      page === undefined ? 1 : Number(page),
      limit === undefined ? 20 : Number(limit),
    );
  }

  // ==========================================
  // POST /api/v1/admin/products
  // ==========================================

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo sản phẩm',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
  })
  @ApiBody({
    type: ProductCreateDto,
  })
  @ApiCreatedResponse({
    description: 'Tạo sản phẩm thành công.',
  })
  create(
    @Body() dto: ProductCreateDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() requester: ProductRequester,
  ) {
    return this.productsService.create(
      dto,
      idempotencyKey,
      requester,
    );
  }

  // ==========================================
  // PATCH /api/v1/admin/products/:productId
  // ==========================================

  @Patch(':productId')
  @ApiOperation({
    summary: 'Cập nhật sản phẩm theo quyền',
  })
  @ApiBody({
    type: ProductPatchDto,
  })
  @ApiOkResponse({
    description: 'Cập nhật sản phẩm thành công.',
  })
  update(
    @Param('productId') productId: string,
    @Body() dto: ProductPatchDto,
    @CurrentUser() requester: ProductRequester,
  ) {
    return this.productsService.update(
      productId,
      dto,
      requester,
    );
  }

  // ==========================================
  // DELETE /api/v1/admin/products/:productId
  // ==========================================

  @Delete(':productId')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa sản phẩm chưa có tham chiếu',
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'Version sản phẩm dạng chuỗi có dấu ngoặc kép, ví dụ: "1"',
    example: '"1"',
  })
  @ApiNoContentResponse({
    description: 'Xóa thành công, không có response body.',
  })
  async remove(
    @Param('productId') productId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() requester: ProductRequester,
  ): Promise<void> {
    await this.productsService.remove(
      productId,
      ifMatch,
      requester,
    );
  }
}
