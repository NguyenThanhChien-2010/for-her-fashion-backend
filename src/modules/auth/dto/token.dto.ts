import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

// TokenRequest của contract: dùng cho /auth/email-verifications/confirm.
// Token raw chỉ đi qua request, không được log hoặc lưu dạng plain text.
export class TokenDto {
  @ApiProperty({ description: 'Token một lần nhận qua email.', example: 'one-time-token-example', writeOnly: true })
  @IsString()
  @Length(1, 512)
  token!: string;
}
