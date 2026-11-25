
import {
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

  @Get()
  @ApiOperation({
    summary: 'Danh mục màu chuẩn để chọn biến thể',
    operationId: 'm02_get_admin_colors',
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
    description:
      'Danh sách màu chuẩn kèm thông tin phân trang.',
  })
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

  @Get()
  @ApiOperation({
    summary: 'Danh mục size và hậu tố chuẩn',
    operationId: 'm02_get_admin_sizes',
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
    description:
      'Danh sách size chuẩn kèm thông tin phân trang.',
  })
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
