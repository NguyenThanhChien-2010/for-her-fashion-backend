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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  app.use(helmet());
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
      exceptionFactory: validationExceptionFactory,
    }),
  );

  if (nodeEnv !== 'production') {
    SwaggerModule.setup('docs', app, resolveContractDocument(app));
  }

  await app.listen(config.getOrThrow<number>('PORT'));
}

function resolveContractDocument(app: Parameters<typeof createSwaggerDocument>[0]): OpenAPIObject {
  const contractPath = join(process.cwd(), 'docs', 'for-her-fashion-openapi.yaml');
  try {
    return parseYaml(readFileSync(contractPath, 'utf8')) as OpenAPIObject;
  } catch {
    return createSwaggerDocument(app);
  }
}

void bootstrap();
