import 'reflect-metadata';
import { ValidationPipe, Type } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { validationExceptionFactory } from '../../common/errors/api-error';
import { CategoriesService } from '../categories/categories.service';
import { CategoryPatchDto } from '../categories/dto/category-patch.dto';
import { ProductCreateDto } from './dto/product-create.dto';
import { ProductPatchDto } from './dto/product-patch.dto';
import { VariantCreateDto } from './dto/variant-create.dto';
import { VariantPatchDto } from './dto/variant-patch.dto';
import { SizeChartCreateDto } from './dto/size-chart-create.dto';
import { SizeChartPatchDto } from './dto/size-chart-patch.dto';
import { ProductsService } from './products.service';
import { PublicProductVariantsService } from './public-product-variants.service';
import { ProductVariantsService } from './product-variants.service';
import { VariantPatchService } from './variant-patch.service';
import { SizeChartsService } from './size-charts.service';
import { PublicSizeChartService } from './public-size-chart.service';
import { InventoryService } from '../inventory/inventory.service';
import { AdminInventoryService } from '../inventory/admin-inventory.service';
import { InventoryMovementService } from '../inventory/inventory-movement.service';

type BoundaryCase = [string, string, string, 'ID_RANGE' | 'VERSION_RANGE' | 'CONTROL_VALID', () => Promise<unknown>];

describe('BE-02 signed Int input boundary', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: validationExceptionFactory });
  const body = async <T extends object>(cls: Type<T>, value: object): Promise<T> =>
    (await pipe.transform(value, { type: 'body', metatype: cls })) as T;
  let accesses = 0;
  const tripwire = new Error('MOCK_BOUNDARY');
  // No real Prisma or idempotency service instance is constructed.
  const mock = new Proxy({}, { get() { accesses++; throw tripwire; } }) as never;
  const cat = new CategoriesService(mock, mock);
  const prod = new ProductsService(mock, mock);
  const pubVar = new PublicProductVariantsService(mock);
  const variant = new ProductVariantsService(mock, mock);
  const varPatch = new VariantPatchService(mock);
  const chart = new SizeChartsService(mock, mock);
  const pubChart = new PublicSizeChartService(mock);
  const inv = new InventoryService(mock);
  const adminInv = new AdminInventoryService(mock);
  const mov = new InventoryMovementService(mock);
  const actor = { id: 1, role: UserRole.ADMIN };
  const key = 'be02-boundary-audit-01';
  const over = '2147483648', max = '2147483647', version = Number(over);
  const pCreate = { name: 'Audit item', slug: 'audit-item', baseCode: 'AUDIT01', categoryId: '1', price: 100000, status: 'ACTIVE' };
  const cCreate = { name: 'Audit chart', scopeType: 'PRODUCT', scopeId: '1', unit: 'cm', rows: [{ sizeCode: 'M', measurements: { chest: 90, waist: 72, hip: 96 } }] };
  const CatPatch = CategoryPatchDto, ProdCreate = ProductCreateDto, ProdPatch = ProductPatchDto;
  const VarCreate = VariantCreateDto, VarPatch = VariantPatchDto, ChartCreate = SizeChartCreateDto, ChartPatch = SizeChartPatchDto;
  const cases: BoundaryCase[] = [
 ['I01','GET /products/{productId}/variants','productId','ID_RANGE',()=>pubVar.findAll(over,{})],
 ['I02','GET /products/{productId}/variants','colorId','ID_RANGE',()=>pubVar.findAll('1',{colorId:over})],
 ['I03','GET /products/{productId}/size-chart','productId','ID_RANGE',()=>pubChart.getForProduct(over)],
 ['I04','POST /admin/products','categoryId','ID_RANGE',async()=>prod.create(await body(ProdCreate,{...pCreate,categoryId:over}),key,actor)],
 ['I05','PATCH /admin/products/{productId}','productId','ID_RANGE',async()=>prod.update(over,await body(ProdPatch,{version:1,name:'Updated'}),actor)],
 ['I06','PATCH /admin/products/{productId}','categoryId','ID_RANGE',async()=>prod.update('1',await body(ProdPatch,{version:1,categoryId:over}),actor)],
 ['I07','DELETE /admin/products/{productId}','productId','ID_RANGE',()=>prod.remove(over,'"1"',actor)],
 ['I08','POST /admin/products/{productId}/variants','productId','ID_RANGE',async()=>variant.create(over,await body(VarCreate,{colorId:'1',sizeCode:'M'}),key,actor)],
 ['I09','POST /admin/products/{productId}/variants','colorId','ID_RANGE',async()=>variant.create('1',await body(VarCreate,{colorId:over,sizeCode:'M'}),key,actor)],
 ['I10','PATCH /admin/variants/{variantId}','variantId','ID_RANGE',async()=>varPatch.update(over,await body(VarPatch,{version:1,colorDisplayLabel:'Red'}),actor)],
 ['I11','GET /admin/size-charts/{chartId}','chartId','ID_RANGE',()=>chart.getById(over)],
 ['I12','POST /admin/size-charts','scopeId','ID_RANGE',async()=>chart.create(await body(ChartCreate,{...cCreate,scopeId:over}),key,actor)],
 ['I13','PATCH /admin/size-charts/{chartId}','chartId','ID_RANGE',async()=>chart.patch(over,await body(ChartPatch,{version:1,name:'Updated'}))],
 ['I14','PATCH /admin/size-charts/{chartId}','scopeId','ID_RANGE',async()=>chart.patch('1',await body(ChartPatch,{version:1,scopeId:over}))],
 ['I15','DELETE /admin/size-charts/{chartId}','chartId','ID_RANGE',()=>chart.remove(over,'"1"')],
 ['I16','PATCH /admin/categories/{categoryId}','categoryId','ID_RANGE',async()=>cat.update(over,await body(CatPatch,{version:1,name:'Updated'}),actor)],
 ['I17','GET /variants/{variantId}/availability','variantId','ID_RANGE',()=>inv.getPublicAvailability(over)],
 ['I18','GET /admin/inventory','variantId','ID_RANGE',()=>adminInv.findAll({variantId:over})],
 ['I19','GET /admin/inventory/{variantId}/movements','variantId','ID_RANGE',()=>mov.findAll(over,{})],
 ['V01','PATCH /admin/categories/{categoryId}','version','VERSION_RANGE',async()=>cat.update('1',await body(CatPatch,{version,name:'Updated'}),actor)],
 ['V02','DELETE /admin/categories/{categoryId}','If-Match','VERSION_RANGE',()=>cat.remove('1',`"${over}"`,actor)],
 ['V03','PATCH /admin/products/{productId}','version','VERSION_RANGE',async()=>prod.update('1',await body(ProdPatch,{version,name:'Updated'}),actor)],
 ['V04','DELETE /admin/products/{productId}','If-Match','VERSION_RANGE',()=>prod.remove('1',`"${over}"`,actor)],
 ['V05','PATCH /admin/variants/{variantId}','version','VERSION_RANGE',async()=>varPatch.update('1',await body(VarPatch,{version,colorDisplayLabel:'Red'}),actor)],
 ['V06','PATCH /admin/size-charts/{chartId}','version','VERSION_RANGE',async()=>chart.patch('1',await body(ChartPatch,{version,name:'Updated'}))],
 ['V07','DELETE /admin/size-charts/{chartId}','If-Match','VERSION_RANGE',()=>chart.remove('1',`"${over}"`)],
 ['C01','GET /products/{productId}/variants','max productId','CONTROL_VALID',()=>pubVar.findAll(max,{})],
 ['C02','GET /products/{productId}/size-chart','max productId','CONTROL_VALID',()=>pubChart.getForProduct(max)],
 ['C03','GET /admin/size-charts/{chartId}','max chartId','CONTROL_VALID',()=>chart.getById(max)],
 ['C04','GET /variants/{variantId}/availability','max variantId','CONTROL_VALID',()=>inv.getPublicAvailability(max)],
 ['I20','POST /admin/products','imageFileIds','ID_RANGE',async()=>prod.create(await body(ProdCreate,{...pCreate,imageFileIds:[over]}),key,actor)],
 ['I21','PATCH /admin/products/{productId}','imageFileIds','ID_RANGE',async()=>prod.update('1',await body(ProdPatch,{version:1,imageFileIds:[over]}),actor)],
 ['C05','PATCH /admin/categories/{categoryId}','max version','CONTROL_VALID',async()=>cat.update('1',await body(CatPatch,{version:Number(max),name:'Updated'}),actor)],
 ['C06','PATCH /admin/products/{productId}','max version','CONTROL_VALID',async()=>prod.update('1',await body(ProdPatch,{version:Number(max),name:'Updated'}),actor)],
 ['C07','PATCH /admin/variants/{variantId}','max version','CONTROL_VALID',async()=>varPatch.update('1',await body(VarPatch,{version:Number(max),colorDisplayLabel:'Red'}),actor)],
 ['C08','PATCH /admin/size-charts/{chartId}','max version','CONTROL_VALID',async()=>chart.patch('1',await body(ChartPatch,{version:Number(max),name:'Updated'}))]
 ];
  it.each(cases.map(([id, route, field, kind, call]) => ({ label: `${id} ${route} ${field}`, kind, call })))('$label', async ({ kind, call }) => {
    accesses = 0;
    if (kind === 'CONTROL_VALID') {
      await expect(call()).rejects.toBe(tripwire);
      expect(accesses).toBe(1);
    } else {
      await expect(call()).rejects.toMatchObject({ status: 400, response: { code: 'VALIDATION_ERROR' } });
      expect(accesses).toBe(0);
    }
  });
});
