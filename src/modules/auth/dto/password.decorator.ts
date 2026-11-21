import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export function StrongPassword(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ example: 'StrongPass@123', minLength: 8, maxLength: 128 }),
    IsString(),
    Length(8, 128),
    Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$(?![\s\S])/, {
      message: 'Password must contain uppercase, lowercase, number and special character',
    }),
  );
}
