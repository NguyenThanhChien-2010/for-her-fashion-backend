import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { FileUploadService } from './file-upload.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
}));

function file(buffer: Buffer, size = buffer.length): Express.Multer.File {
  return {
    buffer,
    size,
    originalname: '../../evil.html',
    mimetype: 'text/html',
  } as Express.Multer.File;
}

describe('FileUploadService', () => {
  const config = new ConfigService({ UPLOAD_DEST: './uploads', MAX_FILE_SIZE_MB: 1 });
  let service: FileUploadService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new FileUploadService(config);
  });

  it.each([
    ['jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['gif', 'image/gif', Buffer.from('GIF87a')],
    ['gif', 'image/gif', Buffer.from('GIF89a')],
    ['webp', 'image/webp', Buffer.from('524946460400000057454250', 'hex')],
  ])(
    'saves detected %s using UUID storageKey and exclusive async write',
    async (extension, mimeType, buffer) => {
      const result = await service.validateAndSave(file(buffer));
      expect(result.storageKey).toMatch(new RegExp(`^[0-9a-f-]{36}\\.${extension}$`));
      expect(result.url).toBe(`/uploads/${result.storageKey}`);
      expect(result.mimeType).toBe(mimeType);
      expect(result.sizeBytes).toBe(buffer.length);
      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining(result.storageKey),
        buffer,
        { flag: 'wx' },
      );
    },
  );

  it.each([
    Buffer.alloc(0),
    Buffer.from('<svg/>'),
    Buffer.from('RIFFxxxxWAVE'),
    Buffer.from('GIF89'),
    Buffer.from([0xff, 0xd8]),
  ])('rejects empty, unsupported or truncated signatures', async (buffer) => {
    await expect(service.validateAndSave(file(buffer))).rejects.toThrow(BadRequestException);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([Buffer.from('GIF89a'), Buffer.from('524946460400000057454250', 'hex')])(
    'rejects non JPG/PNG when the endpoint restricts mime types',
    async (buffer) => {
      await expect(
        service.validateAndSave(file(buffer), { allowedMimeTypes: ['image/jpeg', 'image/png'] }),
      ).rejects.toThrow(BadRequestException);
      expect(writeFile).not.toHaveBeenCalled();
    },
  );

  it('returns a BAD_REQUEST code with a file detail', async () => {
    await expect(service.validateAndSave(file(Buffer.from('<svg/>')))).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'BAD_REQUEST',
        details: [expect.objectContaining({ field: 'file' })],
      }),
    });
  });

  it('checks actual bytes even when the declared size is smaller', async () => {
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    Buffer.from([0xff, 0xd8, 0xff]).copy(buffer);
    await expect(service.validateAndSave(file(buffer, 1))).rejects.toThrow(BadRequestException);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects an inconsistent declared size', async () => {
    await expect(service.validateAndSave(file(Buffer.from('GIF89a'), 100))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('does not swallow exclusive-create failures', async () => {
    (writeFile as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'EEXIST' }),
    );
    await expect(service.validateAndSave(file(Buffer.from('GIF89a')))).rejects.toThrow('exists');
  });

  it('removes an orphaned file without masking the original failure', async () => {
    (unlink as jest.Mock).mockRejectedValueOnce(new Error('EPERM'));
    await expect(service.remove('/tmp/missing.jpg')).resolves.toBeUndefined();
  });
});
