
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  PRODUCT_API_STATUSES,
  ProductApiStatus,
} from './product-create.dto';

const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;

export class ProductPatchDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Phiên bản hiện tại của sản phẩm.',
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({
    example: 'Áo dài Mộc Tâm mới',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    example: 'ao-dai-moc-tam-moi',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  slug?: string;

  @ApiPropertyOptional({
    example: 'AD10005',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  baseCode?: string;

  @ApiPropertyOptional({
    example: '2',
  })
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_ID_PATTERN)
  categoryId?: string;

  @ApiPropertyOptional({
    example: 450000,
    minimum: 1,
    maximum: 999999999999,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999999999999)
  price?: number;

  @ApiPropertyOptional({
    example: 'Mô tả sản phẩm được cập nhật.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['1', '3'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(POSITIVE_ID_PATTERN, { each: true })
  imageFileIds?: string[];

  @ApiPropertyOptional({
    enum: PRODUCT_API_STATUSES,
    example: 'HIDDEN',
  })
  @IsOptional()
  @IsIn(PRODUCT_API_STATUSES)
  status?: ProductApiStatus;
}
