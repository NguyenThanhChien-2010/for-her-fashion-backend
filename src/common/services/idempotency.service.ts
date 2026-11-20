import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';
import { apiErrorPayload, ErrorCode } from '../errors/api-error';

class DuplicateClaimError extends Error {}

// Shared anti-duplicate service, port sang IdempotencyKey của schema Leader:
//   key + subjectKey + scope (unique), state PROCESSING|COMPLETED, response Json?, expiresAt.
// BE-04/BE-05 dùng execute(...) cho checkout hoặc IPN; side effect ngoài DB phải qua outbox.
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * All business database writes must use tx. External calls, emails and file
   * writes cannot roll back: enqueue an outbox record in tx for those effects.
   * Pass a deterministic representation of the validated request.
   * Callbacks must return JSON data, without Dates, undefined or class instances.
   */
  async execute<T extends Prisma.JsonValue>(
    subjectKey: string,
    key: string,
    scope: string,
    fn: (
      tx: PrismaTransactionClient,
    ) => Promise<{ statusCode: number; data: T }>,
    canonicalRequest: string,
  ): Promise<T> {
    const secret =
      this.config.get<string>('IDEMPOTENCY_SECRET') ??
      this.config.get<string>('JWT_ACCESS_SECRET') ??
      this.config.getOrThrow<string>('JWT_SECRET');
    const requestHash = createHmac('sha256', secret)
      .update(JSON.stringify(['idempotency/v1', subjectKey, scope, key, canonicalRequest]))
      .digest('hex');
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
          this.assertMatchingRequest(existing.requestHash, requestHash);
          if (existing.state !== 'COMPLETED') {
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
              requestHash,
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
      if (error instanceof DuplicateClaimError || this.isPrismaError(error, 'P2034')) {
        // Read after rollback, outside the failed transaction's old snapshot.
        const existing = await this.prisma.idempotencyKey.findUnique({ where });
        if (existing && existing.expiresAt > new Date()) {
          this.assertMatchingRequest(existing.requestHash, requestHash);
          if (existing.state === 'COMPLETED') return existing.response as T;
        }
        throw new ConflictException('Request is in progress; retry with the same key');
      }
      throw error;
    }
  }

  private assertMatchingRequest(stored: string | null, received: string): void {
    if (stored === null) {
      throw new ConflictException('This key was recorded without a request fingerprint');
    }
    if (stored !== received) {
      throw new ConflictException(apiErrorPayload(ErrorCode.IDEMPOTENCY_KEY_REUSED));
    }
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}
