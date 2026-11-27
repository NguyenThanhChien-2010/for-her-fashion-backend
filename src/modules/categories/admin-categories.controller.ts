
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
  CategoriesService,
  CategoryRequester,
} from './categories.service';

import { CategoryCreateDto } from './dto/category-create.dto';
import { CategoryPatchDto } from './dto/category-patch.dto';
import { CategoryQueryDto } from './dto/category-query.dto';

@ApiTags('M02')
@ApiBearerAuth()
@Controller('admin/categories')
@Roles(UserRole.ADMIN, UserRole.STAFF)
export class AdminCategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
  ) {}

  // GET /api/v1/admin/categories
  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách danh mục quản trị',
  })
  @ApiOkResponse({
    description: 'Danh sách danh mục có phân trang.',
  })
  list(@Query() query: CategoryQueryDto) {
    return this.categoriesService.listAdmin(query);
  }

  // POST /api/v1/admin/categories
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo danh mục mới',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Khóa chống tạo trùng dài 16–128 ký tự.',
  })
  @ApiBody({
    type: CategoryCreateDto,
  })
  @ApiCreatedResponse({
    description: 'Tạo danh mục thành công.',
  })
  create(
    @Body() dto: CategoryCreateDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() requester: CategoryRequester,
  ) {
    return this.categoriesService.create(
      dto,
      idempotencyKey,
      requester,
    );
  }

  // PATCH /api/v1/admin/categories/:categoryId
  @Patch(':categoryId')
  @ApiOperation({
    summary: 'Cập nhật danh mục',
  })
  @ApiBody({
    type: CategoryPatchDto,
  })
  @ApiOkResponse({
    description: 'Cập nhật danh mục thành công.',
  })
  update(
    @Param('categoryId') categoryId: string,
    @Body() dto: CategoryPatchDto,
    @CurrentUser() requester: CategoryRequester,
  ) {
    return this.categoriesService.update(
      categoryId,
      dto,
      requester,
    );
  }

  // DELETE /api/v1/admin/categories/:categoryId
  @Delete(':categoryId')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa danh mục',
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Phiên bản danh mục cần xóa.',
  })
  @ApiNoContentResponse({
    description: 'Xóa danh mục thành công.',
  })
  async remove(
    @Param('categoryId') categoryId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() requester: CategoryRequester,
  ): Promise<void> {
    await this.categoriesService.remove(
      categoryId,
      ifMatch,
      requester,
    );
  }
}
