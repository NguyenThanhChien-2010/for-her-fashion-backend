import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext, INestApplication, Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import type { App } from 'supertest/types';
import type { Response } from 'supertest';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../src/common/interceptors/transform-response.interceptor';

@Injectable()
export class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: {
        authorization?: string;
      };
      user?: {
        id: number;
        role: UserRole;
      };
    }>();

    const roles = new Map<string, UserRole>([
      ['Bearer test-admin', UserRole.ADMIN],
      ['Bearer test-staff', UserRole.STAFF],
      ['Bearer test-customer', UserRole.CUSTOMER],
    ]);

    const role = roles.get(
      req.headers.authorization ?? '',
    );

    if (!role) {
      throw new UnauthorizedException();
    }

    req.user = {
      id: role === UserRole.ADMIN ? 1 : 2,
      role,
    };

    return true;
  }
}

export async function createInventoryTestApp(
  prismaMock: object,
  loggerMock: object,
  authGuard: Type<CanActivate>,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [InventoryModule],
    providers: [
      { provide: PinoLogger, useValue: loggerMock },
      { provide: APP_GUARD, useClass: authGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

export function expectNoInventoryWrites(mocks: readonly jest.Mock[]): void {
  for (const mock of mocks) {
    expect(mock).not.toHaveBeenCalled();
  }
}

export function expectSafeInventoryError(
  res: Response,
  internalMessage: string,
  loggerMock: { error: jest.Mock },
): void {
  expect(res.body).toMatchObject({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: expect.any(String),
      details: expect.any(Array),
    },
    traceId: expect.any(String),
  });
  expect(JSON.stringify(res.body)).not.toContain(internalMessage);
  expect(loggerMock.error).toHaveBeenCalled();
}
