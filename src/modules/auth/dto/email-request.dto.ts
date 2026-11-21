import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class EmailRequestDto {
  @ApiProperty({ example: 'khach@example.com', format: 'email' })
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
