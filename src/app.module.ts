import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { appConfigValidationSchema } from './common/config/app.config';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { UploadsModule } from './modules/uploads/uploads.module';

// Composition root: giữ cấu trúc import của Leader (ConfigModule + PrismaModule + AuthModule),
// bổ sung hạ tầng dùng chung M01 (CommonModule, UploadsModule) và các global cross-cutting.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: appConfigValidationSchema }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Không bao giờ ghi Authorization/Cookie vào log (chứa Bearer và refresh token).
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        autoLogging: false,
        // Ưu tiên X-Request-ID của client/proxy, nếu không có thì sinh UUID; header set ngay tại đây
        // để header và traceId trong body lỗi luôn khớp nhau.
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const header = req.headers['x-request-id'];
          const incoming = Array.isArray(header) ? header[0] : header;
          const id =
            typeof incoming === 'string' && incoming.trim()
              ? incoming.trim()
              : randomUUID();
          res.setHeader('X-Request-ID', id);
          return id;
        },
      },
    }),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20 }),
    // Throttle toàn cục chống brute-force; route auth nhạy cảm siết riêng bằng @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Thứ tự guard: JwtAuthGuard → RolesGuard → ThrottlerGuard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
  ],
})
export class AppModule {}
