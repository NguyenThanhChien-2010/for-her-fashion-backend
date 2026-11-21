import {
  ArgumentsHost,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { Prisma, UserRole } from '@prisma/client';
import { of } from 'rxjs';
import type { ValidationError } from 'class-validator';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { appConfigValidationSchema } from './config/app.config';
import { ErrorCode, flattenValidationErrors, validationExceptionFactory } from './errors/api-error';
import { resolveTraceId, TransformResponseInterceptor } from './interceptors/transform-response.interceptor';

const context = (user?: { role: UserRole }): ExecutionContext =>
  ({
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

function errorHost(request: Record<string, unknown> = { method: 'GET', url: '/', headers: {} }) {
  const json = jest.fn();
  const setHeader = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }), headersSent: false, setHeader };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, json, setHeader, response };
}

function interceptorHost(request: Record<string, unknown>, statusCode: number) {
  const setHeader = jest.fn();
  const response = { statusCode, setHeader };
  const executionContext = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { executionContext, setHeader };
}

describe('Response envelope and error contract', () => {
  it('wraps success payload as { data, traceId } and echoes X-Request-ID', () => {
    const request: Record<string, unknown> = { headers: { 'x-request-id': 'req-abc-123' } };
    const { executionContext, setHeader } = interceptorHost(request, 200);
    const interceptor = new TransformResponseInterceptor();
    let body: unknown;
    interceptor
      .intercept(executionContext, { handle: () => of({ id: 'u1' }) })
      .subscribe((value) => {
        body = value;
      });
    expect(body).toEqual({ data: { id: 'u1' }, traceId: 'req-abc-123' });
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-abc-123');
  });

  it('uses pino req.id when the client sends no header', () => {
    expect(resolveTraceId({ headers: {}, id: 'pino-7' })).toBe('pino-7');
  });

  it('generates a UUID when neither header nor req.id exists', () => {
    expect(resolveTraceId({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('emits no body for 204 so Express accepts the response', () => {
    const { executionContext } = interceptorHost({ headers: {} }, 204);
    const interceptor = new TransformResponseInterceptor();
    let body: unknown = 'unset';
    interceptor
      .intercept(executionContext, { handle: () => of(undefined) })
      .subscribe((value) => {
        body = value;
      });
    expect(body).toBeUndefined();
  });

  it('maps validation errors to VALIDATION_ERROR with field details', () => {
    const errors: ValidationError[] = [
      { property: 'email', constraints: { isEmail: 'email must be an email' }, children: [] },
      {
        property: 'items',
        children: [
          {
            property: '0',
            children: [
              { property: 'quantity', constraints: { min: 'quantity must be positive' }, children: [] },
            ],
          } as unknown as ValidationError,
        ],
      },
    ];
    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'email', message: 'email must be an email' },
      { field: 'items.0.quantity', message: 'quantity must be positive' },
    ]);
    const exception = validationExceptionFactory(errors);
    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getResponse()).toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('hides internal error details and maps Prisma codes to contract codes', () => {
    const { host, json, setHeader } = errorHost();
    const filter = new AllExceptionsFilter({ error: jest.fn() } as unknown as PinoLogger);

    filter.catch(new Error('database password secret'), host);
    expect(json).toHaveBeenLastCalledWith({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
        details: [],
      },
      traceId: expect.any(String),
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('database password secret');
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));

    const cases: Array<[string, string]> = [
      ['P2002', 'CONFLICT'],
      ['P2025', 'NOT_FOUND'],
      ['P2034', 'CONFLICT'],
    ];
    for (const [code, errorCode] of cases) {
      filter.catch(
        new Prisma.PrismaClientKnownRequestError('internal', { code, clientVersion: '6.19.3' }),
        host,
      );
      expect(json).toHaveBeenLastCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: errorCode }) }),
      );
    }
  });

  it('maps P2002 to the contract CONFLICT message and keeps the unique field name only', () => {
    const { host, json } = errorHost();
    const filter = new AllExceptionsFilter({ error: jest.fn() } as unknown as PinoLogger);
    filter.catch(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['email'] },
      }),
      host,
    );
    expect(json).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: {
          code: 'CONFLICT',
          message: 'Dữ liệu đã tồn tại trong hệ thống.',
          details: [{ field: 'email', message: 'Giá trị này đã được sử dụng.' }],
        },
      }),
    );
  });

  it.each([
    [new UnauthorizedException('no token'), 'UNAUTHORIZED'],
    [new ForbiddenException('nope'), 'FORBIDDEN'],
    [new NotFoundException('missing'), 'NOT_FOUND'],
  ])('maps %s to the matching contract code', (exception, code) => {
    const { host, json } = errorHost();
    const filter = new AllExceptionsFilter({ error: jest.fn() } as unknown as PinoLogger);
    filter.catch(exception, host);
    expect(json).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code }) }),
    );
  });

  it('treats a raw string-array BadRequestException as VALIDATION_ERROR', () => {
    const { host, json } = errorHost();
    const filter = new AllExceptionsFilter({ error: jest.fn() } as unknown as PinoLogger);
    filter.catch(new BadRequestException(['email must be an email', 'password too short']), host);
    expect(json).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: [
            { field: '', message: 'email must be an email' },
            { field: '', message: 'password too short' },
          ],
        }),
      }),
    );
  });
});

describe('Common security contracts', () => {
  it('rejects staff on an admin route and accepts admin', () => {
    const reflector = { getAllAndOverride: () => [UserRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(context({ role: UserRole.STAFF }))).toThrow();
    expect(guard.canActivate(context({ role: UserRole.ADMIN }))).toBe(true);
    expect(() => guard.canActivate(context())).toThrow();
  });

  it('answers FORBIDDEN code instead of leaking a raw message', () => {
    const reflector = { getAllAndOverride: () => [UserRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    try {
      guard.canActivate(context({ role: UserRole.STAFF }));
      throw new Error('guard should have thrown');
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('bypasses Passport only for public metadata', () => {
    const guard = new JwtAuthGuard({ getAllAndOverride: () => true } as unknown as Reflector);
    expect(guard.canActivate(context())).toBe(true);
    expect(() => guard.handleRequest(null, false)).toThrow();
  });

  it('requires at least one JWT secret and rejects an invalid upload limit', () => {
    expect(appConfigValidationSchema.validate({ DATABASE_URL: 'mysql://u:p@h:3306/d' }).error).toBeDefined();
    expect(
      appConfigValidationSchema.validate({
        DATABASE_URL: 'mysql://u:p@h:3306/d',
        JWT_SECRET: 'a'.repeat(16),
        MAX_FILE_SIZE_MB: -1,
      }).error,
    ).toBeDefined();
    expect(
      appConfigValidationSchema.validate({
        DATABASE_URL: 'mysql://u:p@h:3306/d',
        JWT_SECRET: 'a'.repeat(16),
      }).error,
    ).toBeUndefined();
  });
});
