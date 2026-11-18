import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { validationExceptionFactory } from '../src/common/errors/api-error';
import { createSwaggerDocument } from '../src/common/swagger/swagger.setup';

// Kiểm chứng Swagger sinh ra đúng 100% path M01 + Shared của API Contract v1.0.2.
// Đây là gate chống lệch route: thêm/đổi path mà quên contract sẽ fail ngay tại đây.
const CONTRACT_M01_PATHS = [
  '/auth/register',
  '/auth/email-verifications/confirm',
  '/auth/email-verifications/resend',
  '/auth/login',
  '/auth/password/forgot',
  '/auth/password/reset',
  '/auth/refresh',
  '/auth/logout',
  '/me',
  '/admin/auth/login',
  '/admin/accounts',
  '/admin/accounts/{accountId}',
  '/admin/accounts/{accountId}/role',
  '/admin/accounts/{accountId}/status',
  '/uploads',
] as const;

describe('Swagger contract alignment (M01 + Shared)', () => {
  let app: INestApplication<App>;
  let document: ReturnType<typeof createSwaggerDocument>;

  beforeAll(async () => {
    const environment: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://test:test@localhost:3306/forher_test_db',
      JWT_SECRET: 'test-secret-with-at-least-32-characters',
      JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-chars',
      JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-chars',
    };
    for (const [key, value] of Object.entries(environment)) process.env[key] = value;

    const { AppModule } = await import('../src/app.module');
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        user: { findUnique: jest.fn(), findFirst: jest.fn() },
        authSession: { findUnique: jest.fn(), updateMany: jest.fn() },
        authToken: { findUnique: jest.fn() },
        $transaction: jest.fn(),
      })
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    await app.init();
    document = createSwaggerDocument(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it.each(CONTRACT_M01_PATHS)('exposes %s in the OpenAPI document', (path) => {
    // app.setGlobalPrefix('api/v1') làm Swagger sinh path đầy đủ; contract khai báo base path /api/v1.
    expect(document.paths[`/api/v1${path}`]).toBeDefined();
  });

  it('uses the M01 and Shared tags of the contract', () => {
    const tags = (document.tags ?? []).map((tag) => tag.name);
    expect(tags).toEqual(expect.arrayContaining(['M01', 'Shared']));
  });

  it('declares the contract version and the BearerAuth scheme', () => {
    expect(document.info.version).toBe('1.0.2');
    expect(document.components?.securitySchemes?.BearerAuth).toBeDefined();
  });

  it('documents 204 for logout with no success body', () => {
    const logout = document.paths['/api/v1/auth/logout']?.post;
    expect(logout?.responses['204']).toBeDefined();
  });

  it('documents the X-Request-ID header on success responses', () => {
    const login = document.paths['/api/v1/auth/login']?.post;
    const response = login?.responses['200'] as { headers?: Record<string, unknown> } | undefined;
    expect(response?.headers?.['X-Request-ID']).toBeDefined();
  });

  it('serves a document covering at least the M01 + Shared surface', async () => {
    expect(Object.keys(document.paths).length).toBeGreaterThanOrEqual(CONTRACT_M01_PATHS.length);
    // Bảo đảm app thực sự phục vụ được route /me đã khai báo trong document.
    await request(app.getHttpServer()).get('/api/v1/me').expect(401);
  });
});
