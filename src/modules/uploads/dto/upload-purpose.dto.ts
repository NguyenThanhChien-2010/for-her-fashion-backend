import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

// Mục đích tệp theo schema Upload của API Contract v1.0.2 (tag Shared).
export const UPLOAD_PURPOSES = ['REVIEW', 'RETURN', 'PRODUCT', 'REFUND_EVIDENCE'] as const;

export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export class UploadPurposeDto {
  @ApiProperty({
    enum: UPLOAD_PURPOSES,
    description: 'Mục đích của tệp; quyết định quyền truy cập và thư mục nghiệp vụ sử dụng.',
    example: 'REVIEW',
  })
  @IsEnum(UPLOAD_PURPOSES)
  purpose!: UploadPurpose;
}
