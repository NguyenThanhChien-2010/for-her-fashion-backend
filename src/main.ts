import { configureHttp } from './configure-http';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Bootstrap cấu hình middleware bảo mật, prefix API, ValidationPipe và Swagger.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  configureHttp(app);
  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
}

void bootstrap();
