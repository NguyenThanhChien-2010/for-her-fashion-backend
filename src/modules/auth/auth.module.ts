import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAuthController } from './admin-auth.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

// Đóng gói M01 trên nền Leader: PrismaModule (@Global) đã cung cấp PrismaService,
// CommonModule (@Global) cung cấp FileUploadService + IdempotencyService.
// JwtModule.register({}) để AuthService tự truyền secret theo từng loại token.
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  controllers: [AuthController, MeController, AdminAuthController, AdminAccountsController],
  providers: [AuthService, AdminAccountsService, JwtStrategy, JwtRefreshStrategy],
  exports: [AuthService, AdminAccountsService],
})
export class AuthModule {}
