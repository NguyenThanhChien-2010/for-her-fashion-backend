import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { MatchProperty } from '../../../common/validators/match-property.decorator';
import { StrongPassword } from './password.decorator';

export class RegisterDto {
  @ApiProperty({ example: 'Nguyễn An', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  fullName!: string;

  @ApiProperty({ example: 'khach@example.com', format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @StrongPassword()
  password!: string;

  @ApiProperty({ example: 'StrongPass@123', minLength: 8, maxLength: 128, writeOnly: true })
  @IsString()
  @Length(8, 128)
  @MatchProperty('password', { message: 'Mật khẩu xác nhận không khớp.' })
  passwordConfirmation!: string;
}
