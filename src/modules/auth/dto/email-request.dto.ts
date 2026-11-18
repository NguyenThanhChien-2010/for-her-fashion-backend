import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

// EmailRequest của contract: dùng cho /auth/password/forgot và /auth/email-verifications/resend.
// Hai endpoint luôn trả thông báo chung để chống dò email tồn tại (email enumeration).
export class EmailRequestDto {
  @ApiProperty({ example: 'khach@example.com', format: 'email' })
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
