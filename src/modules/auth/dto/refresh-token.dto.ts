import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

// RefreshRequest của contract: refresh token nằm trong body, không phải query string hay cookie.
export class RefreshTokenDto {
  @ApiProperty({ description: 'JWT refresh token.', example: 'refresh-token-example', writeOnly: true })
  @IsString()
  @Length(1, 4096)
  refreshToken!: string;
}
