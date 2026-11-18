import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { StrongPassword } from './password.decorator';

// RegisterRequest của contract: fullName, email, phone, password đều bắt buộc.
// Schema Leader lưu phone trực tiếp trên User.phone (@unique) nên đây cũng là khóa đăng nhập bằng SĐT.
export class RegisterDto {
  @ApiProperty({ example: 'Nguyễn An', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  fullName!: string;

  @ApiProperty({ example: 'khach@example.com', format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '0901234567', pattern: '^\\+?[0-9]{9,15}$' })
  @IsString()
  @Matches(/^\+?[0-9]{9,15}$(?![\s\S])/, { message: 'Số điện thoại không đúng định dạng.' })
  phone!: string;

  @StrongPassword()
  password!: string;
}
