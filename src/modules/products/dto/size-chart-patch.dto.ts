
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

import { Type } from 'class-transformer';

import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  SizeChartRowDto,
} from './size-chart-create.dto';

// ==========================================
// BE-02 / M02
// PATCH SIZE CHART DTO
// ==========================================

export class SizeChartPatchDto {
  // ========================================
  // VERSION - BẮT BUỘC
  // ========================================

  @ApiProperty({
    description:
      'Phiên bản hiện tại của bảng số đo. ' +
      'Backend từ chối nếu version không khớp.',
    example: 1,
    minimum: 1,
    type: Number,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  // ========================================
  // NAME - KHÔNG BẮT BUỘC
  // ========================================

  @ApiPropertyOptional({
    example: 'Bảng số đo váy công sở cập nhật',
    maxLength: 150,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  // ========================================
  // SCOPE TYPE - KHÔNG BẮT BUỘC
  // ========================================

  @ApiPropertyOptional({
    enum: ['PRODUCT', 'GROUP'],
    example: 'PRODUCT',
  })
  @IsOptional()
  @IsIn(['PRODUCT', 'GROUP'])
  scopeType?: 'PRODUCT' | 'GROUP';

  // ========================================
  // SCOPE ID - KHÔNG BẮT BUỘC
  // ========================================

  @ApiPropertyOptional({
    description:
      'ID sản phẩm hoặc danh mục áp dụng.',
    example: '3',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  scopeId?: string;

  // ========================================
  // UNIT - KHÔNG BẮT BUỘC
  // ========================================

  @ApiPropertyOptional({
    enum: ['cm'],
    example: 'cm',
  })
  @IsOptional()
  @IsIn(['cm'])
  unit?: string;

  // ========================================
  // ROWS - KHÔNG BẮT BUỘC
  // ========================================

  @ApiPropertyOptional({
    type: [SizeChartRowDto],
    minItems: 1,
    description:
      'Danh sách dòng số đo mới. ' +
      'Nếu được cung cấp, thay thế danh sách cũ.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SizeChartRowDto)
  rows?: SizeChartRowDto[];

  // ========================================
  // INSTRUCTIONS - CHƯA CÓ CỘT DB
  // ========================================

  @ApiPropertyOptional({
    example: 'Đối chiếu số đo cơ thể.',
    description:
      'Có trong OpenAPI nhưng chưa được hỗ trợ lưu trữ.',
  })
  @IsOptional()
  @IsString()
  instructions?: string;
}
