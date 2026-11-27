
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class VariantCreateDto {
  @ApiProperty({
    example: '1',
    description: 'ID màu chuẩn dạng chuỗi số nguyên dương.',
  })
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  colorId!: string;

  @ApiProperty({
    example: 'S',
    description: 'Mã kích thước đã có trong bảng sizes.',
    maxLength: 10,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  sizeCode!: string;
}
