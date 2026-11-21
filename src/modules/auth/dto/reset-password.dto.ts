import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength, MinLength } from 'class-validator';
import { StrongPassword } from './password.decorator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token đặt lại mật khẩu nhận qua email.', example: 'one-time-token-example', writeOnly: true })
  @IsString()
  @Length(1, 512)
  token!: string;

  @StrongPassword()
  password!: string;

  @ApiProperty({ description: 'Nhập lại mật khẩu mới.', example: 'MatKhauMoi!2026', writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  passwordConfirmation!: string;
}
