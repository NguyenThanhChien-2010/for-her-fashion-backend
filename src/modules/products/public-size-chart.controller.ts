
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

import {
  Public,
} from '../../common/decorators/public.decorator';

import {
  PublicSizeChartService,
} from './public-size-chart.service';

// ==========================================
// BE-02 / M02
// PUBLIC PRODUCT SIZE CHART CONTROLLER
// ==========================================

@ApiTags('M02')
@Public()
@Controller('products')
export class PublicSizeChartController {
  constructor(
    private readonly publicSizeChartService:
      PublicSizeChartService,
  ) {}

  // ==========================================
  // GET /api/v1/products/:productId/size-chart
  // ==========================================

  @Get(':productId/size-chart')
  @ApiOperation({
    summary: 'Bảng số đo đã chọn theo ưu tiên',
    description:
      'Ưu tiên bảng số đo riêng của sản phẩm. ' +
      'Nếu không phù hợp, sử dụng bảng số đo của danh mục. ' +
      'Chỉ trả những size thực tế có trong ProductVariant đang hoạt động.',
    operationId:
      'm02_get_products_productId_size_chart',
  })
  @ApiParam({
    name: 'productId',
    required: true,
    type: String,
    description:
      'ID của sản phẩm cần xem bảng số đo.',
    example: '3',
  })
  @ApiOkResponse({
    description:
      'Trả bảng số đo phù hợp theo thứ tự ưu tiên PRODUCT → GROUP.',
  })
  @ApiBadRequestResponse({
    description:
      'productId không hợp lệ hoặc vượt phạm vi hỗ trợ.',
  })
  @ApiNotFoundResponse({
    description:
      'Sản phẩm không tồn tại, chưa hiển thị hoặc không có bảng số đo phù hợp.',
  })
  getSizeChart(
    @Param('productId') productId: string,
  ) {
    return this.publicSizeChartService.getForProduct(
      productId,
    );
  }
}
