import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../modules/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/database/prisma.service';
import { apiErrorPayload, ErrorCode, ErrorMessage } from '../../common/errors/api-error';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { AuthService } from './auth.service';
import {
  AccountResponse,
  PaginatedAccounts,
  parseContractId,
  toDatabaseStatus,
} from './auth.types';
import {
  AccountQueryDto,
  AccountRoleUpdateDto,
  AccountStatusUpdateDto,
  InternalAccountCreateDto,
} from './dto/account.dto';

@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly idempotency: IdempotencyService,
    private readonly logger: PinoLogger,
  ) {}

  async list(
    query: AccountQueryDto,
    requester: { id: string; role: UserRole },
  ): Promise<PaginatedAccounts> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const scope: Prisma.UserWhereInput =
      requester.role === UserRole.ADMIN ? {} : { role: UserRole.CUSTOMER };

    if (query.role) {
      if (requester.role !== UserRole.ADMIN && query.role !== 'CUSTOMER') {
        throw new ForbiddenException(
          apiErrorPayload(
            ErrorCode.FORBIDDEN,
            'Chỉ quản trị viên được tra cứu tài khoản nội bộ.',
          ),
        );
      }
      scope.role = query.role;
    }

    if (query.q) {
      const keyword = query.q.trim();
      if (keyword) {
        scope.OR = [
          { email: { contains: keyword } },
          { fullName: { contains: keyword } },
          { phone: { contains: keyword } },
        ];
      }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: scope,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where: scope }),
    ]);

    return {
      items: users.map((user) => this.authService.toAccount(user)),
      pagination: { page, limit, total },
    };
  }

  async findOne(
    accountId: string,
    requester: { id: string; role: UserRole },
  ): Promise<AccountResponse> {
    const numericId = parseContractId(accountId);
    if (numericId === null) {
      throw new NotFoundException(
        apiErrorPayload(ErrorCode.NOT_FOUND, 'Không tìm thấy tài khoản.'),
      );
    }
    const user = await this.prisma.user.findFirst({
      where: {
        id: numericId,
        ...(requester.role === UserRole.ADMIN ? {} : { role: UserRole.CUSTOMER }),
      },
    });
    if (!user) {
      throw new NotFoundException(
        apiErrorPayload(ErrorCode.NOT_FOUND, 'Không tìm thấy tài khoản.'),
      );
    }
    return this.authService.toAccount(user);
  }

  async create(
    dto: InternalAccountCreateDto,
    idempotencyKey: string,
    requester: { id: string },
  ): Promise<AccountResponse> {
    const account = (await this.idempotency.execute(
      requester.id,
      idempotencyKey,
      'admin.accounts.create',
      async (tx) => ({
        statusCode: 201,
        data: (await this.createAccount(tx, dto, requester.id)) as unknown as Prisma.JsonObject,
      }),
    )) as unknown as AccountResponse;

    this.logger.info({ accountId: account.id }, 'Internal account create request completed');
    return account;
  }

  private async createAccount(
    tx: PrismaTransactionClient,
    dto: InternalAccountCreateDto,
    createdBy: string,
  ): Promise<AccountResponse> {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim();
    const duplicate = await tx.user.findFirst({
      where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        apiErrorPayload(
          ErrorCode.CONFLICT,
          'Email hoặc số điện thoại đã được đăng ký.',
        ),
      );
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    const creatorId = parseContractId(createdBy);
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        ...(phone ? { phone } : {}),
        role: dto.role === 'ADMIN' ? UserRole.ADMIN : UserRole.STAFF,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        ...(creatorId !== null ? { createdBy: creatorId } : {}),
      },
    });

    await this.createUserAuditLog(tx, {
      actorId: creatorId,
      action: 'INTERNAL_ACCOUNT_CREATE',
      entityId: String(user.id),
      after: {
        role: user.role,
        status: user.status,
      },
    });

    return this.authService.toAccount(user);
  }

  async updateRole(
    accountId: string,
    dto: AccountRoleUpdateDto,
    requester: { id: string; role: UserRole },
  ): Promise<AccountResponse> {
    const numericId = this.requireAccountId(accountId);
    this.assertNotSelf(numericId, requester.id, 'role');
    const current = await this.getTargetOrThrow(numericId);

    if (current.role === UserRole.CUSTOMER) {
      throw new BadRequestException(
        apiErrorPayload(
          ErrorCode.BAD_REQUEST,
          'Chỉ tài khoản nội bộ mới được phân vai trò qua endpoint này.',
        ),
      );
    }
    this.assertVersion(current.version, dto.version);

    await this.applyUserUpdate(
      numericId,
      dto.version,
      {
        role: dto.role === 'ADMIN' ? UserRole.ADMIN : UserRole.STAFF,
        version: { increment: 1 },
      },
      { action: 'ROLE_UPDATE', reason: dto.reason, actorId: requester.id },
    );
    return this.reload(numericId);
  }

  async updateStatus(
    accountId: string,
    dto: AccountStatusUpdateDto,
    requester: { id: string; role: UserRole },
  ): Promise<AccountResponse> {
    const numericId = this.requireAccountId(accountId);
    this.assertNotSelf(numericId, requester.id, 'status');
    const current = await this.getTargetOrThrow(numericId);
    this.assertVersion(current.version, dto.version);

    const nextStatus = toDatabaseStatus(dto.status);
    await this.applyUserUpdate(
      numericId,
      dto.version,
      {
        status: nextStatus,
        version: { increment: 1 },
        ...(nextStatus === UserStatus.LOCKED
          ? { lockedReason: dto.reason }
          : { lockedReason: null }),
      },
      { action: 'STATUS_UPDATE', reason: dto.reason, actorId: requester.id },
      nextStatus === UserStatus.LOCKED,
    );
    return this.reload(numericId);
  }

  private async applyUserUpdate(
    accountId: number,
    version: number,
    data: Prisma.UserUpdateManyMutationInput,
    audit: { action: string; reason: string; actorId: string },
    revokeSessions = false,
  ): Promise<void> {
    const actorId = parseContractId(audit.actorId);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: accountId, version },
        data,
      });
      if (!result.count) {
        throw new ConflictException(
          apiErrorPayload(ErrorCode.CONFLICT, ErrorMessage.CONFLICT_STATE),
        );
      }
      if (revokeSessions) {
        await tx.authSession.updateMany({
          where: { userId: accountId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.createUserAuditLog(tx, {
        actorId,
        action: audit.action,
        entityId: String(accountId),
        after: { reason: audit.reason },
      });
      this.logger.info(
        {
          action: audit.action,
          accountId,
          actorId: audit.actorId,
          reason: audit.reason,
        },
        'Account administration update',
      );
    });
  }

  private createUserAuditLog(
    tx: PrismaTransactionClient,
    audit: {
      actorId: number | null;
      action: string;
      entityId: string;
      after: Prisma.InputJsonObject;
    },
  ) {
    return tx.auditLog.create({
      data: {
        ...(audit.actorId !== null ? { actorId: audit.actorId } : {}),
        action: audit.action,
        entityType: 'User',
        entityId: audit.entityId,
        after: audit.after,
      },
    });
  }

  private async getTargetOrThrow(accountId: number): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: accountId } });
    if (!user) {
      throw new NotFoundException(
        apiErrorPayload(ErrorCode.NOT_FOUND, 'Không tìm thấy tài khoản.'),
      );
    }
    return user;
  }

  private async reload(accountId: number): Promise<AccountResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: accountId } });
    return this.authService.toAccount(user);
  }

  private requireAccountId(accountId: string): number {
    const numericId = parseContractId(accountId);
    if (numericId === null) {
      throw new NotFoundException(
        apiErrorPayload(ErrorCode.NOT_FOUND, 'Không tìm thấy tài khoản.'),
      );
    }
    return numericId;
  }

  private assertVersion(current: number, requested: number): void {
    if (current !== requested) {
      throw new ConflictException(
        apiErrorPayload(ErrorCode.CONFLICT, ErrorMessage.CONFLICT_STATE),
      );
    }
  }

  private assertNotSelf(
    accountId: number,
    requesterId: string,
    field: 'role' | 'status',
  ): void {
    // Tránh admin tự khóa hoặc hạ quyền tài khoản đang dùng.
    if (String(accountId) === requesterId) {
      throw new ForbiddenException(
        apiErrorPayload(
          ErrorCode.FORBIDDEN,
          `Bạn không thể tự thay đổi ${field === 'role' ? 'vai trò' : 'trạng thái'} của chính mình.`,
        ),
      );
    }
  }
}
