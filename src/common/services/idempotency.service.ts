import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';

class DuplicateClaimError extends Error {}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ghi nghiệp vụ qua tx; side effect ngoài DB cần đi qua outbox. Kết quả phải là JSON. */
  async execute<T extends Prisma.JsonValue>(
    subjectKey: string,
    key: string,
    scope: string,
    fn: (
      tx: PrismaTransactionClient,
    ) => Promise<{ statusCode: number; data: T }>,
  ): Promise<T> {
    const where = { subjectKey_scope_key: { subjectKey, scope, key } };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        // Xóa key hết hạn trước khi chiếm key mới.
        await tx.idempotencyKey.deleteMany({
          where: { subjectKey, scope, key, expiresAt: { lte: now } },
        });
        const existing = await tx.idempotencyKey.findUnique({ where });
        if (existing) {
          if (existing.state === 'PROCESSING') {
            throw new ConflictException('Request is in progress');
          }
          return existing.response as T;
        }

        const claim = await tx.idempotencyKey
          .create({
            data: {
              subjectKey,
              scope,
              key,
              state: 'PROCESSING',
              expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            },
          })
          .catch((error: unknown) => {
            // P2002 tại đây nghĩa là request khác đã chiếm key.
            if (this.isPrismaError(error, 'P2002')) throw new DuplicateClaimError();
            throw error;
          });

        const result = await fn(tx);
        await tx.idempotencyKey.update({
          where: { id: claim.id },
          data: {
            state: 'COMPLETED',
            response: result.data ?? Prisma.JsonNull,
            resourceId: String(result.statusCode),
          },
        });
        return result.data;
      });
    } catch (error) {
      if (error instanceof DuplicateClaimError) {
        // Đọc ngoài transaction lỗi để lấy kết quả của request thắng.
        const existing = await this.prisma.idempotencyKey.findUnique({ where });
        if (existing && existing.state !== 'PROCESSING' && existing.expiresAt > new Date()) {
          return existing.response as T;
        }
        throw new ConflictException('Request is in progress; retry with the same key');
      }
      if (this.isPrismaError(error, 'P2034')) {
        throw new ConflictException('Concurrent request; retry with the same key');
      }
      throw error;
    }
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}
