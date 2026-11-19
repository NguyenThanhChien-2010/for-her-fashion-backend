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

// M01 — quản trị tài khoản theo schema Leader (User.id Int, version Int, emailVerifiedAt DateTime?).
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly idempotency: IdempotencyService,
    private readonly logger: PinoLogger,
  ) {}

  // GET /admin/accounts — Admin xem mọi role; Staff chỉ xem CUSTOMER theo đúng phạm vi contract.
  async list(
    query: AccountQueryDto,
    requester: { id: string; role: UserRole },
  ): Promise<PaginatedAccounts> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const scope: Prisma.UserWhereInput =
      requester.role === UserRole.ADMIN ? {} : { role: UserRole.CUSTOMER };

    if (query.role) {
      // Staff yêu cầu role nội bộ phải bị chặn 403 thay vì âm thầm trả tập rỗng.
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
        // Tìm theo họ tên, email hoặc số điện thoại; dùng contains để hỗ trợ tìm một phần.
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
        // Sắp xếp ổn định theo createdAt rồi id để phân trang không lặp/thiếu bản ghi.
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

  // GET /admin/accounts/:accountId — Staff chỉ xem CUSTOMER; ngoài phạm vi trả 404 để không lộ sự tồn tại.
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

  // POST /admin/accounts — tạo tài khoản nội bộ STAFF/ADMIN, đã xác thực để dùng được ngay.
  // Contract bắt buộc header Idempotency-Key: cùng key + payload trả lại kết quả cũ.
  async create(
    dto: InternalAccountCreateDto,
    idempotencyKey: string,
    requester: { id: string },
  ): Promise<AccountResponse> {
    return this.idempotency.execute(
      requester.id,
      idempotencyKey,
      'admin.accounts.create',
      async () => ({
        statusCode: 201,
        // Bản ghi idempotency lưu JSON thuần, không phải class instance.
        data: (await this.createAccount(dto, requester.id)) as unknown as Prisma.JsonObject,
      }),
    ) as unknown as Promise<AccountResponse>;
  }

  private async createAccount(
    dto: InternalAccountCreateDto,
    createdBy: string,
  ): Promise<AccountResponse> {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim();
    const duplicate = await this.prisma.user.findFirst({
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
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        ...(phone ? { phone } : {}),
        role: dto.role === 'ADMIN' ? UserRole.ADMIN : UserRole.STAFF,
        status: UserStatus.ACTIVE,
        // Tài khoản nội bộ do Admin cấp coi như đã xác thực email.
        emailVerifiedAt: new Date(),
        ...(creatorId !== null ? { createdBy: creatorId } : {}),
      },
    });

    this.logger.info({ accountId: user.id }, 'Internal account created');
    return this.authService.toAccount(user);
  }

  // PATCH /admin/accounts/:accountId/role — chỉ đổi role giữa STAFF/ADMIN, kèm optimistic locking.
  async updateRole(
    accountId: string,
    dto: AccountRoleUpdateDto,
    requester: { id: string; role: UserRole },
  ): Promise<AccountResponse> {
    const numericId = this.requireAccountId(accountId);
    this.assertNotSelf(numericId, requester.id, 'role');
    const current = await this.getTargetOrThrow(numericId);

    // Contract: không nâng CUSTOMER thành nội bộ qua endpoint này.
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

  // PATCH /admin/accounts/:accountId/status — LOCKED thu hồi toàn bộ AuthSession đang hiệu lực.
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

  // Cập nhật có điều kiện version trong một transaction: chống ghi đè khi hai Admin cùng sửa.
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
      // count = 0 nghĩa là version đã bị request khác thay đổi giữa lúc đọc và ghi.
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
      // AuditLog của Leader là nơi lưu lý do/actor để truy vết về sau.
      await tx.auditLog.create({
        data: {
          ...(actorId !== null ? { actorId } : {}),
          action: audit.action,
          entityType: 'User',
          entityId: String(accountId),
          after: { reason: audit.reason } satisfies Prisma.InputJsonObject,
        },
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

  // Admin không tự hạ quyền/khóa chính mình để tránh mất quyền quản trị đang dùng.
  private assertNotSelf(
    accountId: number,
    requesterId: string,
    field: 'role' | 'status',
  ): void {
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
