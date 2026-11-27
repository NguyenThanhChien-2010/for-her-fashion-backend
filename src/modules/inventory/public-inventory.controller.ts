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

import { InventoryService } from './inventory.service';

import type {
  PublicAvailabilityResponse,
} from './inventory.service';

@ApiTags('M03')
@Public()
@Controller('variants')
export class PublicInventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
  ) {}

  @Get(':variantId/availability')
  @ApiOperation({
    summary: 'Tồn bán hiện tại của một SKU',
    operationId: 'm03_get_variants_variantId_availability',
    description:
      'Chỉ đọc tồn bán hiện tại. Không giữ hàng, không trừ tồn và không trả dữ liệu đối chiếu nội bộ.',
  })
  @ApiParam({
    name: 'variantId',
    required: true,
    type: String,
    example: '1',
  })
  @ApiOkResponse({
    description: 'Tra cứu tồn bán thành công.',
  })
  @ApiBadRequestResponse({
    description: 'variantId không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description:
      'Biến thể không tồn tại hoặc không được bán.',
  })
  getAvailability(
    @Param('variantId') variantId: string,
  ): Promise<PublicAvailabilityResponse> {
    return this.inventoryService.getPublicAvailability(
      variantId,
    );
  }
}
