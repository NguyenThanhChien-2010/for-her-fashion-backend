import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';

import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { InventoryAdjustmentService } from './inventory-adjustment.service';

import type {
  InventoryAdjustmentResponse,
} from './inventory-adjustment.service';

@ApiTags('M03')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.STAFF)
@ApiUnauthorizedResponse({
  description: 'Chưa đăng nhập hoặc phiên không hợp lệ.',
})
@ApiForbiddenResponse({
  description: 'Không có quyền thực hiện nghiệp vụ.',
})
@Controller('admin/inventory-adjustments')
export class AdminInventoryAdjustmentController {
  constructor(
    private readonly adjustmentService: InventoryAdjustmentService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Lưu yêu cầu điều chỉnh để đối chiếu KiotViet',
    operationId: 'm03_post_admin_inventory_adjustments',
    description:
      'Tiếp nhận đề nghị điều chỉnh. Không ghi đè tồn bán trước khi xác minh kết quả nguồn.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: {
      type: 'string',
      minLength: 16,
      maxLength: 128,
    },
  })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'variantId',
        'version',
        'countedQuantity',
        'reason',
      ],
      properties: {
        variantId: {
          type: 'string',
          pattern: '^[1-9][0-9]*$',
          example: '1',
        },
        version: {
          type: 'integer',
          format: 'int64',
          minimum: 1,
          example: 1,
        },
        countedQuantity: {
          type: 'integer',
          format: 'int64',
          minimum: 0,
          example: 8,
        },
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 2000,
          example: 'Kiểm đếm và đối chiếu tồn kho.',
        },
      },
    },
  })
  @ApiAcceptedResponse({
    description: 'Đã tiếp nhận yêu cầu điều chỉnh.',
  })
  @ApiBadRequestResponse({
    description: 'Dữ liệu hoặc Idempotency-Key không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Biến thể không tồn tại.',
  })
  @ApiConflictResponse({
    description: 'Version thay đổi hoặc khóa nghiệp vụ bị dùng lại.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'SKU chưa đủ điều kiện đối chiếu nguồn.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKey() key: string,
    @Body() body: unknown,
  ): Promise<InventoryAdjustmentResponse> {
    return this.adjustmentService.create(
      user.id,
      key,
      body,
    );
  }

  @Get(':adjustmentId')
  @ApiOperation({
    summary: 'Xem kết quả đối chiếu điều chỉnh',
    operationId: 'm03_get_admin_inventory_adjustments_adjustmentId',
  })
  @ApiParam({
    name: 'adjustmentId',
    required: true,
    schema: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
      example: '1',
    },
  })
  @ApiOkResponse({
    description: 'Tra cứu yêu cầu điều chỉnh thành công.',
  })
  @ApiBadRequestResponse({
    description: 'adjustmentId không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Yêu cầu điều chỉnh không tồn tại.',
  })
  findOne(
    @Param('adjustmentId') adjustmentId: string,
  ): Promise<InventoryAdjustmentResponse> {
    return this.adjustmentService.findOne(adjustmentId);
  }
}
