import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class TokenDto {
  @ApiProperty({ description: 'Token một lần nhận qua email.', example: 'one-time-token-example', writeOnly: true })
  @IsString()
  @Length(1, 512)
  token!: string;
}
