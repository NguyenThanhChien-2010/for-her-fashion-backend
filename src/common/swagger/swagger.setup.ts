import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

// Thẻ Swagger trùng khớp 15 tag của API Contract v1.0.2 để Frontend tra cứu đúng module.
export const CONTRACT_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'M01', description: 'Tài khoản, phiên và phân quyền' },
  { name: 'M02', description: 'Danh mục, sản phẩm, biến thể và bảng số đo' },
  { name: 'M03', description: 'Tồn bán SKU và đối chiếu tồn' },
  { name: 'M04', description: 'Giỏ, yêu thích và phiên mua riêng' },
  { name: 'M05', description: 'Mã ưu đãi' },
  { name: 'M06', description: 'Đơn hàng và checkout' },
  { name: 'M07', description: 'Khoản thu, thanh toán và hoàn tiền' },
  { name: 'M08', description: 'Theo dõi tích hợp KiotViet' },
  { name: 'M09', description: 'Doanh số và chính sách thành viên' },
  { name: 'M10', description: 'Đánh giá' },
  { name: 'M11', description: 'Đổi trả' },
  { name: 'M12', description: 'Tư vấn đặt may' },
  { name: 'M13', description: 'Thông báo' },
  { name: 'M14', description: 'Báo cáo' },
  {
    name: 'Shared',
    description: 'Hạ tầng tệp dùng chung; không phải module nghiệp vụ mới',
  },
];

// Cấu hình OpenAPI dùng chung cho main.ts và test để Swagger luôn phản ánh đúng contract.
export function buildSwaggerConfig(): ReturnType<DocumentBuilder['build']> {
  const builder = new DocumentBuilder()
    .setTitle('For Her Fashion - Website API Contract')
    .setDescription(
      'Backend API cho thương mại điện tử thời trang nữ. Response thành công: { data, traceId }. ' +
        'Response lỗi: { error: { code, message, details }, traceId }. Mọi response có header X-Request-ID.',
    )
    .setVersion('1.0.2')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token 15 phút trong header Authorization.',
      },
      // Tên scheme phải trùng contract để Frontend gen type đọc đúng security scheme.
      'BearerAuth',
    );
  for (const tag of CONTRACT_TAGS) builder.addTag(tag.name, tag.description);
  return builder.build();
}

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildSwaggerConfig());
}

// /docs chỉ bật ngoài production để không công khai bề mặt API của môi trường thật.
export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = createSwaggerDocument(app);
  SwaggerModule.setup('docs', app, document);
  return document;
}
