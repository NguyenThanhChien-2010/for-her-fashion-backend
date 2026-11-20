import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { apiErrorPayload, ErrorCode } from '../../common/errors/api-error';
import { FileUploadService } from '../../common/services/file-upload.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  ApiErrorResponses,
  ApiSuccessResponse,
  UploadDto,
} from '../../common/swagger/api-contract.docs';
import { UploadPurposeDto } from './dto/upload-purpose.dto';

// POST /uploads — hạ tầng tệp dùng chung (tag Shared), không phải module nghiệp vụ.
// Contract: JPG/PNG tối đa 5 MB, mọi role đã đăng nhập đều dùng được, tệp mặc định PRIVATE.
// Schema Leader: model File(storageKey, originalName, mimeType, sizeBytes, uploadedBy, purpose).
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@ApiTags('Shared')
@ApiBearerAuth('BearerAuth')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly fileUpload: FileUploadService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Multer chạy trước pipe nên req.body đã có purpose khi UploadPurposeDto được validate.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'shared_post_uploads',
    summary: 'Tải một tệp để liên kết nghiệp vụ',
    description:
      'Hạ tầng tệp dùng chung, không bổ sung module nghiệp vụ. JPG/PNG tối đa 5 MB. Kiểm tra nội dung thật, sở hữu tệp và không công khai dữ liệu riêng tư.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['purpose', 'file'],
      properties: {
        purpose: {
          type: 'string',
          enum: ['REVIEW', 'RETURN', 'PRODUCT', 'REFUND_EVIDENCE'],
          example: 'REVIEW',
        },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiSuccessResponse(201, UploadDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 422, 429, 500, 503)
  async upload(
    @Body() dto: UploadPurposeDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadDto> {
    // Match the write permissions of ProductCreate/ProductPatch and ManualRefundEvidence/Reconciliation.
    if (
      (dto.purpose === 'PRODUCT' && user.role === UserRole.CUSTOMER) ||
      (dto.purpose === 'REFUND_EVIDENCE' && user.role !== UserRole.ADMIN)
    ) {
      throw new ForbiddenException(apiErrorPayload(ErrorCode.FORBIDDEN));
    }
    if (!file) {
      throw new BadRequestException(
        apiErrorPayload(ErrorCode.BAD_REQUEST, 'Dữ liệu đầu vào không hợp lệ.', [
          { field: 'file', message: 'Vui lòng chọn một tệp để tải lên.' },
        ]),
      );
    }

    const stored = await this.fileUpload.validateAndSave(file, {
      allowedMimeTypes: ALLOWED_IMAGE_TYPES,
    });
    try {
      const created = await this.prisma.file.create({
        data: {
          storageKey: stored.storageKey,
          originalName: file.originalname.slice(0, 255),
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          purpose: dto.purpose,
          uploadedBy: user.id,
        },
        select: { id: true, purpose: true, mimeType: true, sizeBytes: true },
      });
      return {
        // Contract công bố id dạng chuỗi số dù DB lưu Int autoincrement.
        id: String(created.id),
        purpose: created.purpose as UploadDto['purpose'],
        mimeType: created.mimeType as 'image/jpeg' | 'image/png',
        sizeBytes: created.sizeBytes,
        access: 'PRIVATE',
      };
    } catch (error) {
      // Không để tệp mồ côi trên đĩa khi ghi metadata thất bại.
      await this.fileUpload.remove(stored.storedPath);
      throw error;
    }
  }
}
