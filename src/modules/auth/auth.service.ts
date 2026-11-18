import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  issueAccessToken(userId: string, role: string): Promise<string> {
    return this.jwtService.signAsync({ sub: userId, role });
  }
}
