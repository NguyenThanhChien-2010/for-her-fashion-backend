import type {} from 'multer';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { apiErrorPayload, ErrorCode } from '../errors/api-error';

// Kết quả lưu tệp: đường dẫn tĩnh (tương đối) và tên lưu trên đĩa để ghi DB hoặc dọn khi lỗi.
// Schema Leader dùng File.storageKey + originalName + mimeType + sizeBytes; storageKey chính là tên lưu.
export interface StoredFile {
  url: string;
  storageKey: string;
  storedPath: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  sizeBytes: number;
}

export interface SaveFileOptions {
  // Giới hạn loại tệp theo contract của endpoint gọi (ví dụ /uploads chỉ nhận JPG/PNG).
  allowedMimeTypes?: readonly ('image/jpeg' | 'image/png')[];
}

// Shared upload service: kiểm tra magic bytes trước khi lưu, chống giả MIME/đuôi file.
@Injectable()
export class FileUploadService {
  constructor(private readonly config: ConfigService) {}

  async validateAndSave(
    file: Express.Multer.File,
    options: SaveFileOptions = {},
  ): Promise<StoredFile> {
    const buffer = file?.buffer;
    const maxBytes = this.config.get<number>('MAX_FILE_SIZE_MB', 5) * 1024 * 1024;
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length === 0 ||
      buffer.length > maxBytes ||
      file.size !== buffer.length
    ) {
      throw new BadRequestException(
        apiErrorPayload(ErrorCode.VALIDATION_ERROR, 'Dữ liệu đầu vào không hợp lệ.', [
          {
            field: 'file',
            message: `Tệp phải có kích thước từ 1 byte đến ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
          },
        ]),
      );
    }

    const detected = this.detectImage(buffer);
    const allowed = options.allowedMimeTypes;
    if (
      !detected ||
      (allowed && !allowed.includes(detected.mimeType as 'image/jpeg' | 'image/png'))
    ) {
      throw new BadRequestException(
        apiErrorPayload(ErrorCode.VALIDATION_ERROR, 'Dữ liệu đầu vào không hợp lệ.', [
          {
            field: 'file',
            message:
              allowed && allowed.length > 0
                ? 'Chỉ chấp nhận tệp JPG hoặc PNG.'
                : 'Chỉ chấp nhận tệp JPG, PNG, GIF hoặc WEBP.',
          },
        ]),
      );
    }

    const directory = resolve(this.config.get<string>('UPLOAD_DEST', './uploads'));
    const storageKey = `${randomUUID()}.${detected.extension}`;
    const storedPath = resolve(directory, storageKey);
    await mkdir(directory, { recursive: true });
    await writeFile(storedPath, buffer, { flag: 'wx' });
    return {
      url: `/uploads/${storageKey}`,
      storageKey,
      storedPath,
      mimeType: detected.mimeType,
      sizeBytes: buffer.length,
    };
  }

  // Dọn tệp vừa ghi khi bước ghi metadata thất bại, tránh rác trên đĩa.
  async remove(storedPath: string): Promise<void> {
    await unlink(storedPath).catch(() => undefined);
  }

  private detectImage(
    buffer: Buffer,
  ): { extension: string; mimeType: StoredFile['mimeType'] } | undefined {
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return { extension: 'jpg', mimeType: 'image/jpeg' };
    }
    if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      return { extension: 'png', mimeType: 'image/png' };
    }
    const gifHeader = buffer.subarray(0, 6).toString('latin1');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
      return { extension: 'gif', mimeType: 'image/gif' };
    }
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).equals(Buffer.from('RIFF')) &&
      buffer.subarray(8, 12).equals(Buffer.from('WEBP'))
    ) {
      return { extension: 'webp', mimeType: 'image/webp' };
    }
    return undefined;
  }
}
