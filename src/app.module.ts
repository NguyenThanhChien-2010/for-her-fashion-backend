
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
import { CategoriesModule } from './modules/categories/categories.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: appConfigValidationSchema,
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        // Không ghi token hoặc cookie vào log.
        redact: ['req.headers.authorization', 'req.headers.cookie'],

        autoLogging: false,

        genReqId: (
          req: IncomingMessage,
          res: ServerResponse,
        ) => {
          // Dùng cùng một mã cho header và log để lần theo request.
          const header = req.headers['x-request-id'];

          const incoming = Array.isArray(header)
            ? header[0]
            : header;

          const id =
            typeof incoming === 'string' && incoming.trim()
              ? incoming.trim()
              : randomUUID();

          res.setHeader('X-Request-ID', id);

          return id;
        },
      },
    }),

    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
    }),

    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),

    // Database
    PrismaModule,

    // Shared Services
    CommonModule,

    // BE-01: Authentication
    AuthModule,

    // BE-02: Categories
    CategoriesModule,

    // Shared: Uploads
    UploadsModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,

    // Global Authentication Guard
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },

    // Global Authorization Guard
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },

    // Global Rate Limiting
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // Global Exception Filter
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },

    // Global Response Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformResponseInterceptor,
    },
  ],
})
export class AppModule {}
