import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email hoặc số điện thoại đã đăng ký.',
    example: 'khach@example.com',
    minLength: 1,
    maxLength: 254,
  })
  @IsString()
  @Length(1, 254)
  identifier!: string;

  @ApiProperty({ description: 'Mật khẩu đăng nhập.', example: 'MatKhauMinhHoa!2026', writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiPropertyOptional({
    description: 'true: duy trì phiên dài hạn (30 ngày) thay vì 7 ngày mặc định.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
