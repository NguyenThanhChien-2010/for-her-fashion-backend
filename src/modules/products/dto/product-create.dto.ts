
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

const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;

export const PRODUCT_API_STATUSES = [
  'ACTIVE',
  'HIDDEN',
  'DISCONTINUED',
] as const;

export type ProductApiStatus =
  (typeof PRODUCT_API_STATUSES)[number];

export class ProductCreateDto {
  @ApiProperty({
    example: 'Áo dài Mộc Tâm',
    maxLength: 255,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    example: 'ao-dai-moc-tam',
    maxLength: 255,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  slug!: string;

  @ApiProperty({
    example: 'AD10005',
    maxLength: 40,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  baseCode!: string;

  @ApiProperty({
    example: '2',
    description: 'ID danh mục dạng chuỗi số nguyên dương.',
  })
  @IsString()
  @Matches(POSITIVE_ID_PATTERN)
  categoryId!: string;

  @ApiProperty({
    example: 350000,
    minimum: 1,
    maximum: 999999999999,
    description: 'Giá bán VND nguyên, không dùng số thực.',
  })
  @IsInt()
  @Min(1)
  @Max(999999999999)
  price!: number;

  @ApiPropertyOptional({
    example: 'Mô tả sản phẩm',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['1', '2'],
    description: 'Danh sách ID file ảnh đã upload.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(POSITIVE_ID_PATTERN, { each: true })
  imageFileIds?: string[];

  @ApiProperty({
    enum: PRODUCT_API_STATUSES,
    example: 'ACTIVE',
  })
  @IsIn(PRODUCT_API_STATUSES)
  status!: ProductApiStatus;
}
