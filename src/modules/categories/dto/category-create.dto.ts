
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CategoryCreateDto {
  @ApiProperty({ example: 'Áo dài', maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ example: 'ao-dai', maxLength: 191 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  slug!: string;

  @ApiPropertyOptional({
    example: '1',
    nullable: true,
    description: 'ID danh mục cha',
  })
  @ValidateIf((_object, value: unknown) => value != null)
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  parentId?: string | null;

  @ApiProperty({ example: true })
  @IsBoolean()
  isVisible!: boolean;
}
