import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { validationExceptionFactory } from '../src/common/errors/api-error';

// E2E cho toàn bộ bề mặt M01 + Shared của API Contract v1.0.2 trên schema Leader (Int id).
const ACCESS_SECRET = 'test-access-secret-with-at-least-32-chars';
const REFRESH_SECRET = 'test-refresh-secret-with-at-least-32-chars';
// Fixture E2E: credential giả lập, không phải bí mật thật và không dùng ở production.
const SAMPLE_LOGIN_CREDENTIAL = 'MatKhauMinhHoa!2026';
const SAMPLE_INTERNAL_CREDENTIAL = 'MatKhauNoiBo!2026';

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: 'khach@example.com',
    passwordHash: '',
    fullName: 'Nguyễn An',
    phone: '0901234567',
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    lockedReason: null,
    createdBy: null,
    version: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('M01 + Shared HTTP contract', () => {
  let app: INestApplication<App>;
  let prisma: Record<string, never> & {
    user: Record<string, jest.Mock>;
    authSession: Record<string, jest.Mock>;
    authToken: Record<string, jest.Mock>;
    file: Record<string, jest.Mock>;
    idempotencyKey: Record<string, jest.Mock>;
    auditLog: Record<string, jest.Mock>;
    onModuleInit: jest.Mock;
    onModuleDestroy: jest.Mock;
    $transaction: jest.Mock;
  };
  let jwt: JwtService;
  let uploadDir: string;
  let currentUser: ReturnType<typeof userRow>;
  let targetUser: ReturnType<typeof userRow>;

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'forher-uploads-'));
    const environment: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://test:test@localhost:3306/forher_test_db',
      JWT_SECRET: 'test-secret-with-at-least-32-characters',
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      UPLOAD_DEST: uploadDir,
    };
    for (const [key, value] of Object.entries(environment)) process.env[key] = value;

    currentUser = userRow();
    targetUser = userRow({ id: 2, email: 'target@example.com', role: UserRole.STAFF });
    const byId = (args: { where?: { id?: number; email?: string; phone?: string } }) => {
      if (args.where?.email) return currentUser;
      if (args.where?.phone) return currentUser;
      if (args.where?.id === 1) return currentUser;
      if (args.where?.id === 2) return targetUser;
      return null;
    };
    const prismaStub = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      user: {
        findUnique: jest.fn((args: { where?: { id?: number; email?: string; phone?: string } }) =>
          Promise.resolve(byId(args)),
        ),
        findFirst: jest.fn(() => Promise.resolve(currentUser)),
        findMany: jest.fn(() => Promise.resolve([currentUser])),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(targetUser)),
      },
      authSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          userId: 1,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        create: jest.fn().mockResolvedValue({ id: 10 }),
        update: jest.fn().mockResolvedValue({ id: 10 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      authToken: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 20 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      file: {
        create: jest.fn(({ data }: { data: { purpose: string; mimeType: string; sizeBytes: number } }) =>
          Promise.resolve({ id: 30, ...data }),
        ),
      },
      idempotencyKey: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 40 }),
        update: jest.fn().mockResolvedValue({ id: 40 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 50 }) },
    };
    // $transaction chỉ cần chạy callback với chính stub (đóng vai tx client).
    const transactionStub = {
      ...prismaStub,
      $transaction: jest.fn(
        (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(transactionStub),
      ),
    };
    prisma = transactionStub as never;

    const { AppModule } = await import('../src/app.module');
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(transactionStub)
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
    jwt = new JwtService({});
  });

  afterAll(async () => {
    if (app) await app.close();
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    currentUser = userRow();
    targetUser = userRow({ id: 2, email: 'target@example.com', role: UserRole.STAFF });
    jest.clearAllMocks();
    prisma.authSession.findUnique.mockResolvedValue({
      id: 10,
      userId: 1,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  const accessToken = (overrides: Record<string, unknown> = {}) =>
    jwt.sign(
      {
        sub: '1',
        email: 'khach@example.com',
        role: UserRole.CUSTOMER,
        type: 'access',
        sid: '10',
        ...overrides,
      },
      { secret: ACCESS_SECRET, algorithm: 'HS256', expiresIn: 900 },
    );

  it('POST /auth/login returns AuthTokens { accessToken, refreshToken, tokenType, expiresIn, account }', async () => {
    const hash = await argon2.hash(SAMPLE_LOGIN_CREDENTIAL, { type: argon2.argon2id });
    currentUser = userRow({ passwordHash: hash });
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'khach@example.com', password: SAMPLE_LOGIN_CREDENTIAL, rememberMe: true })
      .expect(200);

    expect(result.body.traceId).toEqual(expect.any(String));
    expect(result.body.data).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      account: {
        id: '1',
        fullName: 'Nguyễn An',
        email: 'khach@example.com',
        phone: '0901234567',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerified: true,
        version: 3,
      },
    });
    // Account không được lộ passwordHash ở bất kỳ tầng nào.
    expect(JSON.stringify(result.body)).not.toContain('passwordHash');
  });

  it('POST /admin/auth/login rejects a CUSTOMER account with 403 FORBIDDEN', async () => {
    const hash = await argon2.hash(SAMPLE_LOGIN_CREDENTIAL, { type: argon2.argon2id });
    currentUser = userRow({ passwordHash: hash, role: UserRole.CUSTOMER });
    const result = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ identifier: 'khach@example.com', password: SAMPLE_LOGIN_CREDENTIAL })
      .expect(403);
    expect(result.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /me returns the Account envelope', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(200);
    expect(result.body).toEqual({
      data: {
        id: '1',
        fullName: 'Nguyễn An',
        email: 'khach@example.com',
        phone: '0901234567',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerified: true,
        version: 3,
      },
      traceId: expect.any(String),
    });
  });

  it('GET /me ignores a caller-supplied user id and uses the authenticated owner', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/v1/me?userId=2')
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(200);

    expect(result.body.data.id).toBe('1');
    expect(prisma.user.findUnique.mock.calls.every(([args]) => args.where.id === 1)).toBe(true);
  });

  it('rejects an access token immediately after its session is revoked', async () => {
    prisma.authSession.findUnique.mockResolvedValueOnce({
      id: 10,
      userId: 1,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(401);

    expect(result.body.error.code).toBe('UNAUTHENTICATED');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('POST /auth/logout answers 204 with no response body', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(204);
    expect(result.text).toBe('');
    expect(result.body).toEqual({});
    // Thu hồi đúng AuthSession gắn với sid của access token.
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 10, userId: 1, revokedAt: null } }),
    );
  });

  it('GET /admin/accounts returns items + pagination for an ADMIN', async () => {
    currentUser = userRow({ role: UserRole.ADMIN });
    const token = accessToken({ role: UserRole.ADMIN });
    const result = await request(app.getHttpServer())
      .get('/api/v1/admin/accounts?page=1&limit=20&role=CUSTOMER')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(result.body.data.pagination).toEqual({ page: 1, limit: 20, total: 1 });
    expect(result.body.data.items[0]).toMatchObject({ id: '1', status: 'ACTIVE', version: 3 });
  });

  it('GET /admin/accounts is blocked for a CUSTOMER with 403 FORBIDDEN', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/v1/admin/accounts')
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(403);
    expect(result.body.error.code).toBe('FORBIDDEN');
  });

  it('PATCH /admin/accounts/:id/status maps LOCKED and revokes sessions', async () => {
    currentUser = userRow({ role: UserRole.ADMIN });
    targetUser = userRow({ id: 2, email: 'target@example.com', role: UserRole.STAFF, version: 3 });
    // Response trả bản ghi sau khi ghi: đã LOCKED và version tăng lên 4.
    prisma.user.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve(
        userRow({
          id: 2,
          email: 'target@example.com',
          role: UserRole.STAFF,
          status: UserStatus.LOCKED,
          version: 4,
        }),
      ),
    );
    const token = accessToken({ role: UserRole.ADMIN });
    const result = await request(app.getHttpServer())
      .patch('/api/v1/admin/accounts/2/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 3, status: 'LOCKED', reason: 'Phát hiện gian lận' })
      .expect(200);
    expect(result.body.data).toMatchObject({ status: 'LOCKED', version: 4 });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 2, revokedAt: null } }),
    );
  });

  it('PATCH /admin/accounts/:id/role reports VERSION_CONFLICT on a stale version', async () => {
    currentUser = userRow({ role: UserRole.ADMIN });
    // Bản ghi đã bị người khác cập nhật lên version 5 trong khi client còn giữ version 3.
    targetUser = userRow({ id: 2, email: 'target@example.com', role: UserRole.STAFF, version: 5 });
    const token = accessToken({ role: UserRole.ADMIN });
    const result = await request(app.getHttpServer())
      .patch('/api/v1/admin/accounts/2/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 3, role: 'ADMIN', reason: 'Bổ nhiệm' })
      .expect(409);
    expect(result.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('POST /uploads requires a Bearer token', async () => {
    const result = await request(app.getHttpServer()).post('/api/v1/uploads').expect(401);
    expect(result.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('POST /admin/accounts requires the Idempotency-Key header', async () => {
    currentUser = userRow({ role: UserRole.ADMIN });
    const token = accessToken({ role: UserRole.ADMIN });
    const result = await request(app.getHttpServer())
      .post('/api/v1/admin/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Nhân viên mới',
        email: 'new@example.com',
        password: SAMPLE_INTERNAL_CREDENTIAL,
        role: 'STAFF',
      })
      .expect(400);
    expect(result.body.error.code).toBe('BAD_REQUEST');
    expect(result.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'Idempotency-Key' })]),
    );
  });

  it('POST /admin/accounts creates an internal account when the key is present', async () => {
    currentUser = userRow({ role: UserRole.ADMIN });
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValueOnce(
      userRow({
        id: 5,
        email: 'new@example.com',
        role: UserRole.STAFF,
        version: 1,
      }),
    );
    const token = accessToken({ role: UserRole.ADMIN });
    const result = await request(app.getHttpServer())
      .post('/api/v1/admin/accounts')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'idempotency-key-123456')
      .send({
        fullName: 'Nhân viên mới',
        email: 'new@example.com',
        password: SAMPLE_INTERNAL_CREDENTIAL,
        role: 'STAFF',
      })
      .expect(201);
    expect(result.body.data).toMatchObject({ id: '5', role: 'STAFF', status: 'ACTIVE', version: 1 });
  });

  it.each([4, 5 * 1024 * 1024])('POST /uploads accepts a JPG of %i bytes', async (sizeBytes) => {
    const file = Buffer.alloc(sizeBytes);
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(file);
    const result = await request(app.getHttpServer())
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${accessToken()}`)
      .field('purpose', 'REVIEW')
      .attach('file', file, {
        filename: 'review.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect(result.body.data).toEqual({
      id: '30',
      purpose: 'REVIEW',
      mimeType: 'image/jpeg',
      sizeBytes,
      access: 'PRIVATE',
    });
  });

  it('POST /uploads rejects a non-image payload with BAD_REQUEST', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${accessToken()}`)
      .field('purpose', 'REVIEW')
      .attach('file', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' })
      .expect(400);
    expect(result.body.error.code).toBe('BAD_REQUEST');
    expect(result.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'file' })]),
    );
  });

  it('POST /uploads requires the purpose multipart field', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${accessToken()}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        filename: 'review.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect(result.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects a file over 5 MiB with the contract status and field detail', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${accessToken()}`)
      .field('purpose', 'REVIEW')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'review.jpg')
      .expect(400);
    expect(result.body.error).toMatchObject({
      code: 'BAD_REQUEST',
      details: [{ field: 'file', message: expect.any(String) }],
    });
  });
});
