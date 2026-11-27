
import {
  applyDecorators,
  Controller,
  Get,
  Query,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  UserRole,
} from '@prisma/client';

import {
  Roles,
} from '../../common/decorators/roles.decorator';

import {
  ProductOptionsService,
} from './product-options.service';

// Shared method metadata; preserve the original decorator application order.
function ApiProductOptionList(
  summary: string,
  operationId: string,
  description: string,
) {
  return applyDecorators(
    ApiOkResponse({ description }),
    ApiQuery({ name: 'limit', required: false, type: Number, example: 20 }),
    ApiQuery({ name: 'page', required: false, type: Number, example: 1 }),
    ApiOperation({ summary, operationId }),
    Get(),
  );
}

// ==========================================
// ADMIN COLORS
// ==========================================

@ApiTags('M02')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.STAFF)
@Controller('admin/colors')
export class AdminColorsController {
  constructor(
    private readonly optionsService: ProductOptionsService,
  ) {}

  @ApiProductOptionList(
    'Danh mục màu chuẩn để chọn biến thể',
    'm02_get_admin_colors',
    'Danh sách màu chuẩn kèm thông tin phân trang.',
  )
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.optionsService.listColors(
      page,
      limit,
    );
  }
}

// ==========================================
// ADMIN SIZES
// ==========================================

@ApiTags('M02')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.STAFF)
@Controller('admin/sizes')
export class AdminSizesController {
  constructor(
    private readonly optionsService: ProductOptionsService,
  ) {}

  @ApiProductOptionList(
    'Danh mục size và hậu tố chuẩn',
    'm02_get_admin_sizes',
    'Danh sách size chuẩn kèm thông tin phân trang.',
  )
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.optionsService.listSizes(
      page,
      limit,
    );
  }
}
