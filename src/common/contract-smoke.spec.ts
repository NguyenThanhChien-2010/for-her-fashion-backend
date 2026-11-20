import { describe, it, expect } from '@jest/globals';
import { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { TransformResponseInterceptor } from './interceptors/transform-response.interceptor';
import { appConfigValidationSchema } from './config/app.config';
import { ErrorCode, flattenValidationErrors } from './errors/api-error';

// SPEC tối thiểu cho contract: nếu một trong hai thành phần bị đổi shape, suite này fail ngay.
describe('Contract envelope smoke test', () => {
  it('declares the BAD_REQUEST code used by the Swagger contract', () => {
    expect(ErrorCode.BAD_REQUEST).toBe('BAD_REQUEST');
    expect(flattenValidationErrors([])).toEqual([]);
  });

  it('keeps error body shape { error: { code, message, details }, traceId }', () => {
    const json = jest.fn();
    const setHeader = jest.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/', headers: {} }),
        getResponse: () => ({
          status: jest.fn().mockReturnValue({ json }),
          headersSent: false,
          setHeader,
        }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter({ error: jest.fn() } as unknown as PinoLogger).catch(
      new Error('boom'),
      host,
    );
    expect(json.mock.calls[0][0]).toStrictEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
        details: [],
      },
      traceId: expect.any(String),
    });
  });

  it('keeps success body shape { data, traceId }', () => {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-request-id': 'req-1' } }),
        getResponse: () => ({ statusCode: 200, setHeader: jest.fn() }),
      }),
    } as unknown as ExecutionContext;
    let body: unknown;
    new TransformResponseInterceptor()
      .intercept(context, { handle: () => of([{ id: 'x' }]) })
      .subscribe((value) => {
        body = value;
      });
    expect(body).toStrictEqual({ data: [{ id: 'x' }], traceId: 'req-1' });
  });

  it('requires the JWT remember-me TTL to be configurable', () => {
    const result = appConfigValidationSchema.validate({
      DATABASE_URL: 'mysql://u:p@localhost:3306/db',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REMEMBER_ME_EXPIRES_IN: '30d',
    });
    expect(result.error).toBeUndefined();
  });
});
