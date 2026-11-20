import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { load as parseYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validationExceptionFactory } from './common/errors/api-error';
import { createSwaggerDocument } from './common/swagger/swagger.setup';

export function configureHttp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  app.setGlobalPrefix(config.get<string>('API_PREFIX', 'api/v1'));
  app.use(helmet());
  app.enableCors({
    origin: nodeEnv === 'production'
      ? config.get<string>('ALLOWED_ORIGINS', '').split(',').map((origin) => origin.trim()).filter(Boolean)
      : true,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  }));
  if (nodeEnv !== 'production') {
    SwaggerModule.setup('docs', app, resolveContractDocument(app));
  }
}

function resolveContractDocument(app: INestApplication): OpenAPIObject {
  const contractPath = join(process.cwd(), 'docs', 'for-her-fashion-openapi.yaml');
  try {
    return parseYaml(readFileSync(contractPath, 'utf8')) as OpenAPIObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return createSwaggerDocument(app);
  }
}
