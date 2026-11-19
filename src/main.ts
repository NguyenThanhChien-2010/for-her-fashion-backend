import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { load as parseYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/errors/api-error';
import { createSwaggerDocument } from './common/swagger/swagger.setup';

// Bootstrap cấu hình middleware bảo mật, prefix API, ValidationPipe và Swagger.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // Helmet đặt các security header mặc định (CSP, X-Frame-Options, X-Content-Type-Options...).
  app.use(helmet());
  // Production chỉ cho origin trong ALLOWED_ORIGINS; development mở để Frontend Next.js gọi local.
  app.enableCors({
    origin:
      nodeEnv === 'production'
        ? config
            .get<string>('ALLOWED_ORIGINS', '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
        : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Mọi lỗi validate trả code VALIDATION_ERROR kèm details [{ field, message }] đúng schema ApiError.
      exceptionFactory: validationExceptionFactory,
    }),
  );

  if (nodeEnv !== 'production') {
    // /docs phục vụ contract YAML đã thống nhất của nhóm (đủ 102 path của 14 module).
    // Contract là nguồn sự thật chung; nếu file thiếu thì fallback về document sinh từ decorator
    // để Swagger vẫn hoạt động ở môi trường dev không có file.
    SwaggerModule.setup('docs', app, resolveContractDocument(app));
  }

  // PORT bắt buộc có giá trị hợp lệ qua Joi; getOrThrow fail-fast thay vì âm thầm về 3000.
  await app.listen(config.getOrThrow<number>('PORT'));
}

function resolveContractDocument(app: Parameters<typeof createSwaggerDocument>[0]): OpenAPIObject {
  const contractPath = join(process.cwd(), 'docs', 'for-her-fashion-openapi.yaml');
  try {
    return parseYaml(readFileSync(contractPath, 'utf8')) as OpenAPIObject;
  } catch {
    // Không nuốt lỗi im lặng: document sinh từ decorator luôn phản ánh endpoint đã triển khai.
    return createSwaggerDocument(app);
  }
}

void bootstrap();
