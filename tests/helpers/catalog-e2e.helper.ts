import { Injectable, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import type { CanActivate, ExecutionContext, INestApplication, Provider, Type } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { PinoLogger } from 'nestjs-pino';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { validationExceptionFactory } from '../../src/common/errors/api-error';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../../src/common/interceptors/transform-response.interceptor';
import { IdempotencyService } from '../../src/common/services/idempotency.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

export async function createCatalogTestApp(fixture: TestingModule): Promise<INestApplication<App>> {
  const app = fixture.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  }));
  app.useGlobalFilters(new AllExceptionsFilter({ error: jest.fn() } as unknown as PinoLogger));
  await app.init();
  return app;
}

// Identical token and actor mapping used by the original five catalog guards.
@Injectable()
export class CatalogTestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: { id: number; role: UserRole };
    }>();
    switch (req.headers.authorization) {
      case 'Bearer test-admin':
        req.user = { id: 1, role: UserRole.ADMIN };
        return true;
      case 'Bearer test-staff':
        req.user = { id: 2, role: UserRole.STAFF };
        return true;
      case 'Bearer test-customer':
        req.user = { id: 3, role: UserRole.CUSTOMER };
        return true;
      default:
        throw new UnauthorizedException();
    }
  }
}

export function catalogAdminProviders(
  service: Type<unknown>,
  prismaMock: object,
  idempotencyMock: object,
  authGuard: Type<CanActivate>,
): Provider[] {
  return [
    service,
    { provide: PrismaService, useValue: prismaMock },
    { provide: IdempotencyService, useValue: idempotencyMock },
    { provide: APP_GUARD, useClass: authGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
  ];
}

// A new mock graph per suite, never shared mutable Jest mocks.
export function createSizeChartPatchTxMock() {
  return {
    sizeChart: { findUnique: jest.fn(), updateMany: jest.fn() },
    sizeChartRow: { deleteMany: jest.fn(), createMany: jest.fn() },
    size: { findMany: jest.fn() },
    product: { findUnique: jest.fn(), updateMany: jest.fn() },
    category: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
}
