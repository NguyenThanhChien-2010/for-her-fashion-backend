import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, OperationObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { load as parseYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { configureHttp } from '../src/configure-http';
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

const contract = parseYaml(readFileSync('docs/for-her-fashion-openapi.yaml', 'utf8')) as OpenAPIObject;
const methods = ['get', 'post', 'patch'] as const;
const operations = CONTRACT_M01_PATHS.flatMap((path) =>
  methods.flatMap((method) => {
    const expected = contract.paths[path]?.[method];
    return expected ? [{ path, method, expected }] : [];
  }),
);

function sortedNames(names: readonly string[]): string[] {
  return [...names].sort((left, right) => left.localeCompare(right));
}

function requestShape(doc: OpenAPIObject, operation: OperationObject) {
  const body = operation.requestBody;
  if (!body || !('content' in body)) return {};
  return Object.fromEntries(Object.entries(body.content).map(([mediaType, media]) => {
    const schema = media.schema;
    const resolved: SchemaObject | undefined = schema && '$ref' in schema
      ? doc.components?.schemas?.[schema.$ref.split('/').at(-1) ?? ''] as SchemaObject | undefined
      : schema;
    return [mediaType, {
      properties: sortedNames(Object.keys(resolved?.properties ?? {})),
      required: sortedNames(resolved?.required ?? []),
    }];
  }));
}

function expectedResponses(path: string, expected: OperationObject) {
  const responses = { ...expected.responses };
  // The approved YAML omits 401 on the credential endpoints and the trace header on logout.
  if (['/auth/login', '/admin/auth/login', '/auth/refresh'].includes(path)) {
    responses['401'] ??= { $ref: '#/components/responses/Error401' };
  }
  const logout = responses['204'];
  if (path === '/auth/logout' && logout && !('$ref' in logout)) {
    responses['204'] = {
      ...logout,
      headers: { 'X-Request-ID': { schema: { type: 'string' } }, ...logout.headers },
    };
  }
  return responses;
}

// Dereference local schema and response references before comparing the wire format.
// Only documentation prose, examples and the order of required fields are irrelevant.
function wireSchema(doc: OpenAPIObject, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => wireSchema(doc, item));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    const path = obj.$ref.split('/');
    if (path.shift() !== '#') throw new Error(`Expected local reference: ${obj.$ref}`);
    let resolved: unknown = doc;
    for (const segment of path) resolved = (resolved as Record<string, unknown>)[segment];
    if (!resolved) throw new Error(`Missing reference: ${obj.$ref}`);
    return wireSchema(doc, resolved);
  }
  return Object.fromEntries(Object.entries(obj)
    // JSON omits undefined fields such as headers on responses without headers.
    .filter(([name, entry]) => entry !== undefined && !['description', 'example', 'examples', 'title'].includes(name))
    .map(([name, entry]) => [
      name,
      name === 'required' && Array.isArray(entry) ? sortedNames(entry) : wireSchema(doc, entry),
    ]));
}

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
    configureHttp(app);
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

  it('serves the approved contract at /docs-json', async () => {
    const served = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(served.body).toEqual(contract);
  });

  it('covers all 16 M01 and Shared operations', () => {
    expect(operations).toHaveLength(16);
  });

  it.each(operations)('matches the contract for $method $path', ({ path, method, expected }) => {
    const generated = document.paths[`/api/v1${path}`]?.[method];
    if (!generated) throw new Error(`Missing operation: ${method} ${path}`);
    expect(generated.operationId).toBe(expected.operationId);
    expect(generated.security ?? []).toStrictEqual(expected.security ?? contract.security ?? []);
    expect(requestShape(document, generated)).toStrictEqual(requestShape(contract, expected));
    expect(wireSchema(document, generated.responses))
      .toStrictEqual(wireSchema(contract, expectedResponses(path, expected)));
  });
});
