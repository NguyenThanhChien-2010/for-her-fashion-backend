import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { StrongPassword } from './password.decorator';

// Query params của GET /admin/accounts đúng contract: q, role, page (default 1), limit (default 20, max 100).
export class AccountQueryDto {
  @ApiPropertyOptional({ description: 'Từ khóa tìm theo họ tên, email hoặc số điện thoại.', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['CUSTOMER', 'STAFF', 'ADMIN'], example: 'CUSTOMER' })
  @IsOptional()
  @IsEnum(['CUSTOMER', 'STAFF', 'ADMIN'])
  role?: 'CUSTOMER' | 'STAFF' | 'ADMIN';

  @ApiPropertyOptional({ description: 'Trang bắt đầu từ 1.', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Số bản ghi mỗi trang, tối đa 100.', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// AccountRoleUpdate: bắt buộc version (optimistic locking), role nội bộ và reason để audit.
export class AccountRoleUpdateDto {
  @ApiProperty({ description: 'Phiên bản đã đọc của tài khoản.', minimum: 1, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: ['STAFF', 'ADMIN'], example: 'STAFF' })
  @IsEnum(['STAFF', 'ADMIN'])
  role!: 'STAFF' | 'ADMIN';

  @ApiProperty({ description: 'Lý do thay đổi, lưu lại để audit.', minLength: 1, maxLength: 2000, example: 'Bổ nhiệm theo quyết định nhân sự.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

// AccountStatusUpdate: lý do khóa/mở theo contract và được lưu để audit.
export class AccountStatusUpdateDto {
  @ApiProperty({ description: 'Phiên bản đã đọc của tài khoản.', minimum: 1, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: ['ACTIVE', 'LOCKED'], example: 'LOCKED' })
  @IsEnum(['ACTIVE', 'LOCKED'])
  status!: 'ACTIVE' | 'LOCKED';

  @ApiProperty({ description: 'Lý do lưu để audit. Khi status là LOCKED, giới hạn 255 ký tự.', minLength: 1, maxLength: 2000, example: 'Phát hiện hành vi gian lận.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

// InternalAccountCreate: Admin tạo tài khoản nội bộ; role chỉ STAFF|ADMIN, không nhận CUSTOMER.
// email/phone kiểm tra cùng chuẩn với RegisterRequest để dữ liệu vào một đường duy nhất.
export class InternalAccountCreateDto {
  @ApiProperty({ example: 'Nhân viên For Her', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ example: 'khach@example.com', format: 'email' })
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: '0901234567', pattern: String.raw`^\+?[0-9]{9,15}$` })
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{9,15}$(?![\s\S])/, { message: 'Số điện thoại không đúng định dạng.' })
  phone?: string;

  @StrongPassword()
  password!: string;

  @ApiProperty({ enum: ['STAFF', 'ADMIN'], example: 'STAFF' })
  @IsEnum(['STAFF', 'ADMIN'])
  role!: 'STAFF' | 'ADMIN';
}
