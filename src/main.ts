import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { load as parseYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const contractPath = join(process.cwd(), 'docs', 'for-her-fashion-openapi.yaml');
  const contract = parseYaml(readFileSync(contractPath, 'utf8')) as OpenAPIObject;
  SwaggerModule.setup('docs', app, contract);

  await app.listen(config.get<number>('PORT') ?? 3000);
}

void bootstrap();
