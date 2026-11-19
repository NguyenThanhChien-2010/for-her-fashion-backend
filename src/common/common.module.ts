import { Global, Module } from '@nestjs/common';
import { FileUploadService } from './services/file-upload.service';
import { IdempotencyService } from './services/idempotency.service';

// CommonModule gom hạ tầng dùng chung cho M01..M14.
// PrismaService do PrismaModule (@Global) của Leader cung cấp nên không khai báo lại ở đây.
@Global()
@Module({
  providers: [FileUploadService, IdempotencyService],
  exports: [FileUploadService, IdempotencyService],
})
export class CommonModule {}
