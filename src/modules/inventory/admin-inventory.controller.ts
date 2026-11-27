import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';

import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { Roles } from '../../common/decorators/roles.decorator';

import { AdminInventoryService } from './admin-inventory.service';
import { InventoryMovementService } from './inventory-movement.service';

import type {
  InventoryMovementQuery,
  InventoryMovementListResponse,
} from './inventory-movement.service';

import type {
  AdminInventoryQuery,
  AdminInventoryListResponse,
} from './admin-inventory.service';

@ApiTags('M03')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.STAFF)
@Controller('admin/inventory')
export class AdminInventoryController {
  constructor(
    private readonly adminInventoryService: AdminInventoryService,
    private readonly inventoryMovementService: InventoryMovementService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Tra cứu tồn theo SKU',
    operationId: 'm03_get_admin_inventory',
    description:
      'Tra cứu tồn bán, tồn nguồn, tác động chờ đồng bộ và phiên bản tồn kho theo SKU. Chỉ ADMIN và STAFF được phép truy cập.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description:
      'Tìm kiếm theo SKU, tên sản phẩm hoặc mã sản phẩm gốc.',
    example: 'BE02',
  })
  @ApiQuery({
    name: 'variantId',
    required: false,
    schema: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
      example: '1',
    },
    description: 'ID biến thể dạng số nguyên dương.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      default: 1,
    },
    description: 'Trang hiện tại.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    },
    description: 'Số bản ghi trên mỗi trang.',
  })
  @ApiOkResponse({
    description: 'Tra cứu tồn kho thành công.',
  })
  @ApiBadRequestResponse({
    description: 'Tham số truy vấn không hợp lệ.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Chưa đăng nhập hoặc phiên đăng nhập không hợp lệ.',
  })
  @ApiForbiddenResponse({
    description:
      'Không có quyền truy cập dữ liệu tồn kho nội bộ.',
  })
  findAll(
    @Query() query: AdminInventoryQuery,
  ): Promise<AdminInventoryListResponse> {
    return this.adminInventoryService.findAll(query);
  }

  @Get(':variantId/movements')
  @ApiOperation({
    summary: 'Lịch sử biến động tồn',
    operationId: 'm03_get_admin_inventory_variantId_movements',
    description:
      'Tra cứu lịch sử biến động tồn kho theo SKU. Chỉ ADMIN và STAFF được phép truy cập.',
  })
  @ApiParam({
    name: 'variantId',
    required: true,
    schema: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
      example: '1',
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      default: 1,
    },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    },
  })
  @ApiOkResponse({
    description: 'Tra cứu lịch sử biến động thành công.',
  })
  @ApiBadRequestResponse({
    description: 'Tham số truy vấn không hợp lệ.',
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập.',
  })
  @ApiForbiddenResponse({
    description: 'Không có quyền truy cập.',
  })
  @ApiNotFoundResponse({
    description: 'Biến thể không tồn tại.',
  })
  findMovements(
    @Param('variantId') variantId: string,
    @Query() query: InventoryMovementQuery,
  ): Promise<InventoryMovementListResponse> {
    return this.inventoryMovementService.findAll(
      variantId,
      query,
    );
  }
}
