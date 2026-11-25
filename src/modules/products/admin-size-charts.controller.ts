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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';

import { SizeChartCreateDto } from './dto/size-chart-create.dto';
import { SizeChartPatchDto } from './dto/size-chart-patch.dto';
import { SizeChartsService } from './size-charts.service';

import type { ProductRequester } from './products.service';

// ==========================================
// BE-02 / M02
// ADMIN SIZE CHARTS CONTROLLER
// ==========================================

@ApiTags('M02')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.STAFF)
@Controller('admin/size-charts')
export class AdminSizeChartsController {
  constructor(private readonly service: SizeChartsService) {}

  // ==========================================
  // GET /api/v1/admin/size-charts
  // ==========================================

  @Get()
  @ApiOperation({
    summary: 'Danh sách bảng số đo',
    operationId: 'm02_get_admin_size_charts',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    minimum: 1,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @ApiOkResponse({
    description: 'Danh sách bảng số đo và thông tin phân trang.',
  })
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(page, limit);
  }

  // ==========================================
  // GET /api/v1/admin/size-charts/:chartId
  // ==========================================

  @Get(':chartId')
  @ApiOperation({
    summary: 'Chi tiết bảng số đo',
    description:
      'ADMIN và STAFF xem chi tiết bảng số đo theo ID. ' +
      'Trả về thông tin bảng, phạm vi áp dụng, ' +
      'các dòng số đo và version.',
    operationId: 'm02_get_admin_size_charts_chartId',
  })
  @ApiParam({
    name: 'chartId',
    required: true,
    type: String,
    description: 'ID bảng số đo dạng số nguyên dương.',
    example: '1',
  })
  @ApiOkResponse({
    description: 'Lấy chi tiết bảng số đo thành công.',
  })
  @ApiBadRequestResponse({
    description: 'chartId không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Không tìm thấy bảng số đo.',
  })
  @ApiConflictResponse({
    description: 'Bảng số đo có phạm vi liên kết không hợp lệ.',
  })
  getById(@Param('chartId') chartId: string) {
    return this.service.getById(chartId);
  }

  // ==========================================
  // POST /api/v1/admin/size-charts
  // ==========================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo bảng số đo',
    operationId: 'm02_post_admin_size_charts',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Khóa nghiệp vụ duy nhất, dài 16–128 ký tự.',
  })
  @ApiBody({ type: SizeChartCreateDto })
  @ApiCreatedResponse({
    description: 'Tạo bảng số đo thành công.',
  })
  @ApiBadRequestResponse({
    description: 'Dữ liệu tạo bảng số đo không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Sản phẩm hoặc danh mục không tồn tại.',
  })
  @ApiConflictResponse({
    description:
      'Phạm vi đã được gắn bảng số đo hoặc ' +
      'Idempotency-Key bị sử dụng lại không hợp lệ.',
  })
  create(
    @Body() dto: SizeChartCreateDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() requester: ProductRequester,
  ) {
    return this.service.create(dto, idempotencyKey, requester);
  }

  // ==========================================
  // PATCH /api/v1/admin/size-charts/:chartId
  // ==========================================

  @Patch(':chartId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cập nhật bảng số đo',
    description:
      'ADMIN và STAFF cập nhật thông tin bảng số đo. ' +
      'Bắt buộc gửi version hiện tại. ' +
      'Nếu version đã thay đổi, API trả HTTP 409. ' +
      'Có thể cập nhật tên, đơn vị, instructions, các dòng số đo ' +
      'và phạm vi PRODUCT/GROUP.',
    operationId: 'm02_patch_admin_size_charts_chartId',
  })
  @ApiParam({
    name: 'chartId',
    required: true,
    type: String,
    description: 'ID bảng số đo cần cập nhật.',
    example: '4',
  })
  @ApiBody({
    type: SizeChartPatchDto,
    description:
      'Dữ liệu cập nhật. version là bắt buộc; ' +
      'cần ít nhất một trường thay đổi khác.',
  })
  @ApiOkResponse({
    description: 'Cập nhật thành công, trả về bảng số đo với version mới.',
  })
  @ApiBadRequestResponse({
    description: 'chartId, version hoặc dữ liệu cập nhật không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Bảng số đo hoặc phạm vi đích không tồn tại.',
  })
  @ApiConflictResponse({
    description:
      'Version không còn hợp lệ, ' +
      'phạm vi đích đã có bảng số đo hoặc ' +
      'xảy ra tranh chấp cập nhật.',
  })
  patch(
    @Param('chartId') chartId: string,
    @Body() dto: SizeChartPatchDto,
  ) {
    return this.service.patch(chartId, dto);
  }

  // ==========================================
  // DELETE /api/v1/admin/size-charts/:chartId
  // ==========================================

  @Delete(':chartId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa bảng không còn liên kết',
    description:
      'ADMIN và STAFF chỉ được xóa bảng số đo không còn gắn ' +
      'với bất kỳ sản phẩm hoặc danh mục nào. ' +
      'If-Match phải là version hiện tại, có dấu ngoặc kép, ví dụ "4".',
    operationId: 'm02_delete_admin_size_charts_chartId',
  })
  @ApiParam({
    name: 'chartId',
    required: true,
    type: String,
    description: 'ID bảng số đo dạng số nguyên dương.',
    example: '6',
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'Phiên bản bảng số đo dạng ETag có dấu ngoặc kép. ' +
      'Ví dụ: "4". Không khớp sẽ trả HTTP 409.',
    schema: {
      type: 'string',
      pattern: '^"[1-9][0-9]*"$',
      example: '"4"',
    },
  })
  @ApiNoContentResponse({
    description: 'Xóa thành công, không có response body.',
  })
  @ApiBadRequestResponse({
    description: 'chartId hoặc header If-Match không hợp lệ.',
  })
  @ApiNotFoundResponse({
    description: 'Bảng số đo không tồn tại.',
  })
  @ApiConflictResponse({
    description:
      'Version không khớp hoặc bảng số đo vẫn đang liên kết ' +
      'với sản phẩm/danh mục.',
  })
  async remove(
    @Param('chartId') chartId: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<void> {
    await this.service.remove(chartId, ifMatch);
  }
}
