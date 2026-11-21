import { Global, Module } from '@nestjs/common';
import { FileUploadService } from './services/file-upload.service';
import { IdempotencyService } from './services/idempotency.service';

@Global()
@Module({
  providers: [FileUploadService, IdempotencyService],
  exports: [FileUploadService, IdempotencyService],
})
export class CommonModule {}
