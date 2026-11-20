import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { configureHttp } from '../src/configure-http';
import {
  AUTH_EMAIL_VERIFICATION, AUTH_PASSWORD_RESET, AuthMailEvent,
} from '../src/modules/auth/auth-mail.events';
import type { AuthTokens } from '../src/modules/auth/auth.types';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

describe('BE-01 HTTP + MySQL', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let uploads: string;
  let admin: AuthTokens;
  const verification = new Map<number, string>();
  const passwordReset = new Map<number, string>();
  const tag = randomUUID();
  const email = `customer-${tag}@example.test`;
  const password = `Valid!9${randomUUID().replaceAll('-', '')}`;
  const replacement = `Valid!8${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.BE01_TEST_DATABASE_URL ?? '');
    if (databaseUrl.protocol !== 'mysql:' ||
      !['localhost', '127.0.0.1'].includes(databaseUrl.hostname) ||
      !databaseUrl.pathname.endsWith('_test')) {
      throw new Error('Use a dedicated local MySQL database with a schema ending in _test.');
    }
    uploads = await mkdtemp(join(tmpdir(), 'forher-be01-uploads-'));
    process.env.DATABASE_URL = databaseUrl.href;
    process.env.NODE_ENV = 'test';
    process.env.API_PREFIX = 'api/v1';
    process.env.JWT_SECRET = randomUUID();
    process.env.UPLOAD_DEST = uploads;

    const { AppModule } = await import('../src/app.module');
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    configureHttp(app);
    const events = app.get(EventEmitter2);
    events.on(AUTH_EMAIL_VERIFICATION, ({ userId, token }: AuthMailEvent) => verification.set(userId, token));
    events.on(AUTH_PASSWORD_RESET, ({ userId, token }: AuthMailEvent) => passwordReset.set(userId, token));
    await app.init();
    prisma = app.get(PrismaService);
    const response = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({
      identifier: process.env.SEED_ADMIN_EMAIL ?? 'admin@forher.local',
      password: process.env.SEED_ADMIN_PASSWORD,
    });
    expect(response.status).toBe(200);
    admin = response.body.data as AuthTokens;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (uploads) await rm(uploads, { recursive: true });
  });

  const http = () => request(app.getHttpServer());
  const login = (identifier: string, value: string) =>
    http().post('/api/v1/auth/login').send({ identifier, password: value });
  const denySessions = async (sessions: AuthTokens[]) => {
    // Check all access tokens before a refresh request can change session state.
    await Promise.all(sessions.map(({ accessToken }) =>
      http().get('/api/v1/me').auth(accessToken, { type: 'bearer' }).expect(401),
    ));
    await Promise.all(sessions.map(({ refreshToken }) =>
      http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401),
    ));
  };

  it('verifies email and revokes both sessions on lock and password reset', async () => {
    const registrationBody = {
      email, password, fullName: 'BE-01 Customer', phone: String(randomInt(10_000_000_000, 99_999_999_999)),
    };
    const register = () => http().post('/api/v1/auth/register').send(registrationBody);
    const registrations = await Promise.all([register(), register()]);
    expect(registrations.map((result) => result.status).sort((a, b) => a - b)).toEqual([201, 409]);
    const registration = registrations.find((result) => result.status === 201);
    expect(registration?.body.data).not.toHaveProperty('token');
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await login(email, password).expect(403);

    const previousToken = verification.get(user.id);
    expect(previousToken).toBeDefined();
    await http().post('/api/v1/auth/email-verifications/resend').send({ email }).expect(202);
    const token = verification.get(user.id);
    expect(token).toBeDefined();
    expect(token).not.toBe(previousToken);
    await http().post('/api/v1/auth/email-verifications/confirm').send({ token: previousToken }).expect(400);
    const confirmation = await http().post('/api/v1/auth/email-verifications/confirm').send({ token }).expect(200);
    expect(confirmation.body.data).not.toHaveProperty('accessToken');
    const first = (await login(email, password).expect(200)).body.data as AuthTokens;
    // Reserve HTTP login attempts for assertions on the login endpoint itself.
    const auth = app.get(AuthService);
    const second = await auth.login({ identifier: email, password });
    const rotate = (refreshToken: string) => http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    const rotated = (await rotate(first.refreshToken)).body.data as AuthTokens;
    const rotatedAgain = (await rotate(rotated.refreshToken)).body.data as AuthTokens;
    expect(rotatedAgain.refreshToken).not.toBe(rotated.refreshToken);
    await http().post('/api/v1/uploads').auth(second.accessToken, { type: 'bearer' })
      .field('purpose', 'PRODUCT')
      .attach('file', Buffer.from('89504e470d0a1a0a00000000', 'hex'), 'image.png').expect(403);
    const route = `/api/v1/admin/accounts/${user.id}/status`;
    const status = (version: number, next: string, length: number) => http().patch(route)
      .auth(admin.accessToken, { type: 'bearer' }).send({ version, status: next, reason: 'x'.repeat(length) });

    const rejected = await status(user.version, 'LOCKED', 256).expect(400);
    expect(rejected.body.error.details).toEqual([expect.objectContaining({ field: 'reason' })]);
    await status(user.version, 'LOCKED', 255).expect(200);
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedReason).toHaveLength(255);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'STATUS_UPDATE', entityId: String(user.id) },
      orderBy: { id: 'desc' },
    });
    expect(audit.after).toMatchObject({ status: 'LOCKED', reason: 'x'.repeat(255) });
    await denySessions([rotatedAgain, second]);
    await status(user.version + 1, 'ACTIVE', 2000).expect(200);
    await denySessions([rotatedAgain, second]);

    const fresh = await auth.login({ identifier: email, password });
    await http().post('/api/v1/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
    await http().get('/api/v1/me').auth(fresh.accessToken, { type: 'bearer' }).expect(200);
    const independent = await app.get(PrismaService).authSession.count({ where: { userId: user.id, revokedAt: null } });
    expect(independent).toBe(1);
    // Issue a second session without consuming another HTTP throttle slot.
    const resetPeer = await auth.login({ identifier: email, password });
    await http().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const resetToken = passwordReset.get(user.id);
    expect(resetToken).toBeDefined();
    const reset = { token: resetToken, password: replacement, passwordConfirmation: replacement };
    await http().post('/api/v1/auth/password/reset').send(reset).expect(200);
    await http().post('/api/v1/auth/password/reset').send(reset).expect(400);
    await denySessions([fresh, resetPeer]);
    expect(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await login(email, replacement).expect(200);
  }, 30_000);

  it('verifies the email while keeping the account locked until an admin unlocks it', async () => {
    const identifier = `pending-${tag}@example.test`;
    await http().post('/api/v1/auth/register').send({
      email: identifier, password, fullName: 'Pending Customer',
      phone: String(randomInt(10_000_000_000, 99_999_999_999)),
    }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: identifier } });
    const token = verification.get(user.id);
    const change = (status: string, version: number) => http()
      .patch(`/api/v1/admin/accounts/${user.id}/status`)
      .auth(admin.accessToken, { type: 'bearer' }).send({ status, version, reason: 'Kiểm tra xác thực' });
    await change('LOCKED', user.version).expect(200);
    await http().post('/api/v1/auth/email-verifications/confirm').send({ token }).expect(200);
    const verified = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(verified.emailVerifiedAt).toBeInstanceOf(Date);
    expect(verified.status).toBe('LOCKED');
    await login(identifier, password).expect(403);
    await http().post('/api/v1/auth/email-verifications/confirm').send({ token }).expect(400);
    const conflict = await change('ACTIVE', user.version).expect(409);
    expect(conflict.body.error.code).toBe('VERSION_CONFLICT');
    await change('ACTIVE', user.version + 1).expect(200);
    await login(identifier, password).expect(200);
  });

  it('replays account creation, scopes staff and checks file owner and purpose', async () => {
    const identifier = `staff-${tag}@example.test`;
    const dto = { fullName: 'BE-01 Staff', email: identifier, role: 'STAFF', password };
    const key = randomUUID();
    const create = (body = dto) => http().post('/api/v1/admin/accounts')
      .auth(admin.accessToken, { type: 'bearer' }).set('Idempotency-Key', key).send(body);
    const results = await Promise.all([create(), create()]);
    expect(results.map((result) => result.status)).toContain(201);
    expect(results.every((result) => [201, 409].includes(result.status))).toBe(true);
    const created = (await create().expect(201)).body.data as AuthTokens['account'];
    const duplicate = await create({ ...dto, password: replacement }).expect(409);
    expect(duplicate.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.user.count({ where: { email: identifier } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: 'INTERNAL_ACCOUNT_CREATE', entityId: created.id },
    })).toBe(1);

    const staff = (await http().post('/api/v1/admin/auth/login')
      .send({ identifier, password }).expect(200)).body.data as AuthTokens;
    await http().post('/api/v1/uploads').auth(staff.accessToken, { type: 'bearer' })
      .field('purpose', 'REFUND_EVIDENCE')
      .attach('file', Buffer.from('89504e470d0a1a0a00000000', 'hex'), 'image.png').expect(403);
    await http().get('/api/v1/admin/accounts?role=ADMIN').auth(staff.accessToken, { type: 'bearer' }).expect(403);
    await http().get(`/api/v1/admin/accounts/${admin.account.id}`).auth(staff.accessToken, { type: 'bearer' }).expect(404);
    await http().patch(`/api/v1/admin/accounts/${created.id}/role`).auth(admin.accessToken, { type: 'bearer' })
      .send({ version: created.version, role: 'ADMIN', reason: 'BE-01 verification' }).expect(200);
    await http().get('/api/v1/admin/accounts?role=ADMIN').auth(staff.accessToken, { type: 'bearer' }).expect(200);

    const upload = await http().post('/api/v1/uploads').auth(staff.accessToken, { type: 'bearer' })
      .field('purpose', 'REVIEW')
      .attach('file', Buffer.from('89504e470d0a1a0a00000000', 'hex'), 'image.png').expect(201);
    expect(upload.body.data.access).toBe('PRIVATE');
    const id = Number(upload.body.data.id);
    const service = app.get(UploadsService);
    await expect(service.requireOwnedFile(id, Number(created.id), 'REVIEW')).resolves.toEqual({ id });
    await expect(service.requireOwnedFile(id, Number(admin.account.id), 'REVIEW')).rejects.toMatchObject({ status: 404 });
    await expect(service.requireOwnedFile(id, Number(created.id), 'RETURN')).rejects.toMatchObject({ status: 404 });

    const refreshStaff = () => http().post('/api/v1/auth/refresh').send({ refreshToken: staff.refreshToken });
    const rotations = await Promise.all([refreshStaff(), refreshStaff()]);
    expect(rotations.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 401]);
  }, 30_000);

  it('rolls back a business write and its claim together, then commits once on retry', async () => {
    const key = randomUUID();
    const identifier = `rollback-${tag}@example.test`;
    const scope = 'be01.integration.rollback';
    const service = app.get(IdempotencyService);
    const execute = (shouldFail: boolean) => service.execute(admin.account.id, key, scope, async (tx) => {
      const user = await tx.user.create({
        data: { email: identifier, fullName: 'Rollback Fixture', passwordHash: randomUUID() },
      });
      if (shouldFail) throw new Error('Rollback fixture');
      return { statusCode: 201, data: { id: String(user.id) } };
    }, identifier);
    await expect(execute(true)).rejects.toThrow('Rollback fixture');
    expect(await prisma.user.count({ where: { email: identifier } })).toBe(0);
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
    const result = await execute(false);
    await expect(execute(false)).resolves.toEqual(result);
    expect(await prisma.user.count({ where: { email: identifier } })).toBe(1);
  });
});
