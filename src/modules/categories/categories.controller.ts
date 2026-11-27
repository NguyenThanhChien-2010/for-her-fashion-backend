
import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import { CategoryQueryDto } from './dto/category-query.dto';

@ApiTags('M02')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách danh mục công khai',
  })
  @ApiOkResponse({
    description: 'Danh sách danh mục có phân trang.',
  })
  list(@Query() query: CategoryQueryDto) {
    return this.categoriesService.listPublic(query);
  }
}
