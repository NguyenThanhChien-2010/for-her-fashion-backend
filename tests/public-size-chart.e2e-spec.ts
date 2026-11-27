import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ProductStatus } from '@prisma/client';
import type { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { validationExceptionFactory } from '../src/common/errors/api-error';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { PublicSizeChartController } from '../src/modules/products/public-size-chart.controller';
import { PublicSizeChartService } from '../src/modules/products/public-size-chart.service';

describe('BE-02 Public Size Chart HTTP E2E', () => {
  let app: INestApplication;
  const prismaMock = { product: { findFirst: jest.fn() } };
  const logger = { error: jest.fn() };
  const chart = (id: number, sizeCodes: string[], isActive = true) => ({
    id, name: `Chart ${id}`, unit: 'cm', instructions: 'Size guide',
    version: 2, isActive,
    rows: sizeCodes.map(sizeCode => ({ sizeCode, measurements: { chest: 90, waist: 72 } })),
  });
  const fixture = () => ({
    id: 3, categoryId: 4,
    variants: [{ sizeCode: 'M' }],
    sizeChartDefinition: chart(10, ['M', 'XL']),
    category: { sizeChartDefinition: chart(20, ['M', 'L']) },
  });
  const get = (id = '3') => request(app.getHttpServer())
    .get(`/api/v1/products/${id}/size-chart`).set('X-Request-ID', 'be02-public-size-chart');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicSizeChartController],
      providers: [PublicSizeChartService, { provide: PrismaService, useValue: prismaMock },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      transform: true, exceptionFactory: validationExceptionFactory }));
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter(logger as unknown as PinoLogger));
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.product.findFirst.mockReset().mockResolvedValue(fixture());
  });
  afterAll(async () => { await app?.close(); });

  it('PUBLIC: product chart wins; only active variant sizes are returned', async () => {
    const res = await get().expect(200);
    expect(res.body).toEqual({ data: {
      id: '10', name: 'Chart 10', scopeType: 'PRODUCT', scopeId: '3', unit: 'cm',
      instructions: 'Size guide', rows: [{ sizeCode: 'M', measurements: { chest: 90, waist: 72 } }], version: 2,
    }, traceId: 'be02-public-size-chart' });
    expect(res.headers['x-request-id']).toBe(res.body.traceId);
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 3, status: ProductStatus.ACTIVE },
      select: expect.objectContaining({ variants: { where: { isActive: true }, select: { sizeCode: true } } }),
    }));
  });
  it('GROUP: missing product chart falls back to category', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ ...fixture(), sizeChartDefinition: null });
    const res = await get().expect(200);
    expect(res.body.data).toMatchObject({ id: '20', scopeType: 'GROUP', scopeId: '4', rows: [{ sizeCode: 'M' }] });
    expect(res.body.data.rows).toHaveLength(1);
  });
  it('GROUP: inactive product chart falls back to category', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ ...fixture(), sizeChartDefinition: chart(10, ['M'], false) });
    const res = await get().expect(200);
    expect(res.body.data.scopeType).toBe('GROUP');
  });
  it('GROUP: product chart with no matching size falls back', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ ...fixture(), sizeChartDefinition: chart(10, ['XL']) });
    const res = await get().expect(200);
    expect(res.body.data.scopeType).toBe('GROUP');
  });
  it('PRODUCT: null instructions omitted from JSON', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ ...fixture(), sizeChartDefinition: { ...chart(10, ['M']), instructions: null } });
    const res = await get().expect(200);
    expect(res.body.data).not.toHaveProperty('instructions');
  });
  it.each([
    ['no chart', { ...fixture(), sizeChartDefinition: null, category: { sizeChartDefinition: null } }],
    ['no matching size', { ...fixture(), variants: [{ sizeCode: 'S' }] }],
    ['no active variant', { ...fixture(), variants: [] }],
  ])('404: %s', async (_name, product) => {
    prismaMock.product.findFirst.mockResolvedValue(product);
    const res = await get().expect(404);
    expect(res.body).toMatchObject({ error: { code: 'SIZE_CHART_NOT_AVAILABLE' }, traceId: 'be02-public-size-chart' });
  });
  it('404: no visible product', async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    const res = await get().expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
  it.each(['abc', '0', '2147483648'])('400: invalid product id %s', async (id) => {
    const res = await get(id).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
  });
  it('max valid Int reaches Prisma; nonexistent product 404', async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    await get('2147483647').expect(404);
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2147483647, status: ProductStatus.ACTIVE } }));
  });
});
