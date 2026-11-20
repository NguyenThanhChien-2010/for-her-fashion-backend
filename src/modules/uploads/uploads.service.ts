import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { apiErrorPayload, ErrorCode } from '../../common/errors/api-error';
import { PrismaService } from '../prisma/prisma.service';
import type { UploadPurposeDto } from './dto/upload-purpose.dto';

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async requireOwnedFile(
    fileId: number,
    ownerId: number,
    purpose: UploadPurposeDto['purpose'],
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const file = await tx.file.findFirst({
      where: { id: fileId, uploadedBy: ownerId, purpose },
      select: { id: true },
    });
    if (!file) {
      throw new NotFoundException(apiErrorPayload(ErrorCode.NOT_FOUND, 'Không tìm thấy tệp.'));
    }
    return file;
  }
}
