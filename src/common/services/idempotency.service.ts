
import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  PrismaService,
  PrismaTransactionClient,
} from '../database/prisma.service';

class DuplicateClaimError extends Error {}

@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // IDEMPOTENCY KEY REUSED
  // ==========================================

  private reusedKey(): ConflictException {
    return new ConflictException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message:
        'Idempotency-Key đã được sử dụng cho yêu cầu khác.',
      details: [],
    });
  }

  private assertSameRequest(
    storedHash: string | null | undefined,
    requestHash?: string,
  ): void {
    // Các module cũ không truyền requestHash
    // vẫn sử dụng cơ chế tương thích trước đây.
    if (requestHash === undefined) {
      return;
    }

    // Không thể xác minh payload nếu bản ghi cũ
    // chưa lưu hash. Từ chối thay vì trả nhầm kết quả.
    if (storedHash !== requestHash) {
      throw this.reusedKey();
    }
  }

  // ==========================================
  // EXECUTE
  // ==========================================

  /**
   * Thực hiện nghiệp vụ trong Prisma transaction.
   *
   * subjectKey: người thực hiện
   * key: Idempotency-Key
   * scope: tên nghiệp vụ
   * fn: callback thực hiện nghiệp vụ
   * requestHash: SHA-256 của dữ liệu nghiệp vụ
   *
   * requestHash là tham số tùy chọn để giữ
   * tương thích với các module hiện có.
   *
   * Side effect bên ngoài DB phải đi qua outbox.
   */
  async execute<T extends Prisma.JsonValue>(
    subjectKey: string,
    key: string,
    scope: string,
    fn: (
      tx: PrismaTransactionClient,
    ) => Promise<{
      statusCode: number;
      data: T;
    }>,
    requestHash?: string,
  ): Promise<T> {
    const where = {
      subjectKey_scope_key: {
        subjectKey,
        scope,
        key,
      },
    };

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // ==================================
          // 1. XÓA KEY ĐÃ HẾT HẠN
          // ==================================

          await tx.idempotencyKey.deleteMany({
            where: {
              subjectKey,
              scope,
              key,
              expiresAt: {
                lte: now,
              },
            },
          });

          // ==================================
          // 2. KIỂM TRA KEY ĐÃ TỒN TẠI
          // ==================================

          const existing =
            await tx.idempotencyKey.findUnique({
              where,
            });

          if (existing) {
            // Cùng key nhưng khác payload -> 409.
            this.assertSameRequest(
              existing.requestHash,
              requestHash,
            );

            if (existing.state === 'PROCESSING') {
              throw new ConflictException(
                'Request is in progress',
              );
            }

            if (existing.state !== 'COMPLETED') {
              throw new ConflictException(
                'Idempotency request is not completed',
              );
            }

            // Cùng key và cùng payload:
            // trả lại kết quả đã lưu.
            return existing.response as T;
          }

          // ==================================
          // 3. CLAIM IDEMPOTENCY KEY
          // ==================================

          const claim = await tx.idempotencyKey
            .create({
              data: {
                subjectKey,
                scope,
                key,
                requestHash: requestHash ?? null,
                state: 'PROCESSING',
                expiresAt: new Date(
                  now.getTime() + 24 * 60 * 60 * 1000,
                ),
              },
            })
            .catch((error: unknown) => {
              if (
                this.isPrismaError(error, 'P2002')
              ) {
                throw new DuplicateClaimError();
              }

              throw error;
            });

          // ==================================
          // 4. THỰC HIỆN NGHIỆP VỤ
          // ==================================

          const result = await fn(tx);

          // ==================================
          // 5. LƯU KẾT QUẢ
          // ==================================

          await tx.idempotencyKey.update({
            where: {
              id: claim.id,
            },
            data: {
              state: 'COMPLETED',
              response:
                result.data ?? Prisma.JsonNull,
              resourceId: String(
                result.statusCode,
              ),
            },
          });

          return result.data;
        },
      );
    } catch (error) {
      // ====================================
      // 6. REQUEST ĐỒNG THỜI CÙNG KEY
      // ====================================

      if (error instanceof DuplicateClaimError) {
        const existing =
          await this.prisma.idempotencyKey.findUnique({
            where,
          });

        if (
          existing &&
          existing.expiresAt > new Date()
        ) {
          this.assertSameRequest(
            existing.requestHash,
            requestHash,
          );

          if (existing.state === 'COMPLETED') {
            return existing.response as T;
          }
        }

        throw new ConflictException(
          'Request is in progress; retry with the same key',
        );
      }

      // ====================================
      // 7. DATABASE TRANSACTION CONFLICT
      // ====================================

      if (this.isPrismaError(error, 'P2034')) {
        throw new ConflictException(
          'Concurrent request; retry with the same key',
        );
      }

      throw error;
    }
  }

  // ==========================================
  // PRISMA ERROR HELPER
  // ==========================================

  private isPrismaError(
    error: unknown,
    code: string,
  ): boolean {
    return (
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
