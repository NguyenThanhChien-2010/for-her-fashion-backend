import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';

// Shared module chỉ mount /uploads; FileUploadService đến từ CommonModule, PrismaService từ PrismaModule (@Global).
@Module({
  controllers: [UploadsController],
})
export class UploadsModule {}
