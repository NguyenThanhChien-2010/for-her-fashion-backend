
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SizeChartRowDto {
  @ApiProperty({ example: 'M' })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  sizeCode!: string;

  @ApiProperty({
    example: {
      chest: 90,
      waist: 72,
      hip: 96,
    },
  })
  @IsObject()
  measurements!: Record<string, number>;
}

export class SizeChartCreateDto {
  @ApiProperty({
    example: 'Bảng số đo váy công sở',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    enum: ['PRODUCT', 'GROUP'],
    example: 'GROUP',
  })
  @IsIn(['PRODUCT', 'GROUP'])
  scopeType!: 'PRODUCT' | 'GROUP';

  @ApiProperty({ example: '3' })
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  scopeId!: string;

  @ApiProperty({
    enum: ['cm'],
    example: 'cm',
  })
  @IsIn(['cm'])
  unit!: string;

  @ApiProperty({
    type: [SizeChartRowDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SizeChartRowDto)
  rows!: SizeChartRowDto[];

  @ApiPropertyOptional({
    description:
      'Chưa hỗ trợ lưu trữ cho đến khi có migration.',
  })
  @IsOptional()
  @IsString()
  instructions?: string;
}
