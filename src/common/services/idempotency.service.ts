import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';

class DuplicateClaimError extends Error {}

// Shared anti-duplicate service, port sang IdempotencyKey của schema Leader:
//   key + subjectKey + scope (unique), state PROCESSING|COMPLETED, response Json?, expiresAt.
// BE-04/BE-05 dùng execute(...) cho checkout hoặc IPN; side effect ngoài DB phải qua outbox.
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All business database writes must use tx. External calls, emails and file
   * writes cannot roll back: enqueue an outbox record in tx for those effects.
   * Callbacks must return JSON data, without Dates, undefined or class instances.
   */
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
        // Conditional deletion serializes expiration with the unique-key claim.
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
            // Only a unique violation from this insert represents another owner.
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
        // Read after rollback, outside the failed transaction's old snapshot.
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
