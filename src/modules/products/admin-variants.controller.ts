import {
  Body,
  Controller,
  Param,
  Patch,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { VariantPatchDto } from './dto/variant-patch.dto';
import type { ProductRequester } from './products.service';
import { VariantPatchService } from './variant-patch.service';

@ApiTags('M02')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.STAFF)
@Controller('admin/variants')
export class AdminVariantsController {
  constructor(
    private readonly variantPatchService: VariantPatchService,
  ) {}

  @Patch(':variantId')
  @ApiOperation({
    summary: 'Cập nhật trạng thái hoặc nhãn hiển thị biến thể',
    operationId: 'm02_patch_admin_variants_variantId',
  })
  @ApiParam({
    name: 'variantId',
    description: 'ID biến thể dạng số nguyên dương.',
    example: '1',
  })
  @ApiBody({
    type: VariantPatchDto,
  })
  @ApiOkResponse({
    description: 'Cập nhật biến thể thành công.',
  })
  update(
    @Param('variantId') variantId: string,
    @Body() dto: VariantPatchDto,
    @CurrentUser() requester: ProductRequester,
  ) {
    return this.variantPatchService.update(
      variantId,
      dto,
      requester,
    );
  }
}