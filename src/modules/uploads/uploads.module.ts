import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

// Shared module chỉ mount /uploads; FileUploadService đến từ CommonModule, PrismaService từ PrismaModule (@Global).
@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
