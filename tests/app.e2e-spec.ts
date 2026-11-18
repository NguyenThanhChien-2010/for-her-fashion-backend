import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// Boot the real module graph; database is stubbed so the suite never touches data.
// Mọi assertion bám API Contract v1.0.2: path /api/v1, envelope { data, traceId }, lỗi { error, traceId }.
describe('Application and Auth HTTP contracts', () => {
  let app: INestApplication<App>;

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
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('wraps the root response as { data, traceId } and sets X-Request-ID', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/').expect(200);
    expect(result.body).toEqual({ data: 'Hello World!', traceId: expect.any(String) });
    expect(result.headers['x-request-id']).toBe(result.body.traceId);
  });

  it('echoes a client supplied X-Request-ID for log correlation', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/v1/')
      .set('X-Request-ID', 'req-from-frontend-001')
      .expect(200);
    expect(result.body.traceId).toBe('req-from-frontend-001');
    expect(result.headers['x-request-id']).toBe('req-from-frontend-001');
  });

  it('rejects GET /auth/me because the contract moved the profile to GET /me', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(404);
  });

  it('rejects GET /me without a Bearer token', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(result.body).toMatchObject({
      error: { code: 'UNAUTHORIZED', details: [] },
      traceId: expect.any(String),
    });
  });

  it('rejects invalid registration with VALIDATION_ERROR and field details', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'invalid', password: 'weak', fullName: 'A', phone: 'abc' })
      .expect(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
    );
    expect(result.body.traceId).toEqual(expect.any(String));
  });

  it('rejects unknown fields because RegisterRequest forbids additionalProperties', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'A',
        email: 'a@example.com',
        phone: '0901234567',
        password: 'StrongPass@123',
        role: 'ADMIN',
      })
      .expect(400);
  });

  it('rejects a forged refresh JWT before database access', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'forged-token' })
      .expect(401);
    expect(result.body.error.code).toBe('UNAUTHORIZED');
  });

  it('keeps the legacy password-reset path out of the contract', async () => {
    // Contract dùng /auth/password/forgot; path cũ phải 404 để Frontend không gọi nhầm.
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'a@example.com' })
      .expect(404);
  });

  it('accepts the new forgot-password path and answers 202 ACCEPTED', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'a@example.com' })
      .expect(202);
    expect(result.body).toEqual({
      data: { status: 'ACCEPTED', message: 'Yêu cầu đã được ghi nhận.' },
      traceId: expect.any(String),
    });
  });
});
