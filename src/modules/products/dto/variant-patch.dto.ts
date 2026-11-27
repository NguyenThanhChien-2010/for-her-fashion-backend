import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const VARIANT_PATCH_STATUSES = [
  'ACTIVE',
  'INACTIVE',
] as const;

export type VariantPatchStatus =
  (typeof VARIANT_PATCH_STATUSES)[number];

export class VariantPatchDto {
  @ApiProperty({
    example: 3,
    minimum: 1,
    description: 'Version hiện tại của biến thể.',
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({
    enum: VARIANT_PATCH_STATUSES,
    example: 'INACTIVE',
  })
  @IsOptional()
  @IsIn(VARIANT_PATCH_STATUSES)
  status?: VariantPatchStatus;

  @ApiPropertyOptional({
    example: 'Đỏ',
    maxLength: 100,
  })
  @ValidateIf(
    (_object: VariantPatchDto, value: unknown) =>
      value !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  colorDisplayLabel?: string;

  @ApiPropertyOptional({
    example: 'S',
    maxLength: 100,
  })
  @ValidateIf(
    (_object: VariantPatchDto, value: unknown) =>
      value !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sizeDisplayLabel?: string;
}