import { Prisma, UserRole, UserStatus } from '@prisma/client';

// Access/refresh payload contracts; strategies reject unknown type/sub/tokenId trước khi truy cập DB.
// sid là id AuthSession (Int) được nhúng trong access token để /auth/logout thu hồi đúng phiên.
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: 'access';
  sid?: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  tokenId: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

// ---------------------------------------------------------------------------------------------
// Schema dùng chung theo API Contract v1.0.2 (tag M01 + Shared).
// id trả ra dạng CHUỖI số để khớp pattern ^[1-9][0-9]*$ của contract dù DB lưu Int.
// ---------------------------------------------------------------------------------------------

export type AccountStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED';

export interface AccountResponse {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: AccountStatus;
  emailVerified: boolean;
  version: number;
}

export type ActionResultStatus = 'ACCEPTED' | 'COMPLETED' | 'PENDING_VERIFICATION';

export interface ActionResult {
  status: ActionResultStatus;
  message: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  account: AccountResponse;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface PaginatedAccounts {
  items: AccountResponse[];
  pagination: Pagination;
}

// Schema Leader: UserStatus chỉ có ACTIVE | LOCKED; trạng thái chờ xác thực suy ra từ emailVerifiedAt.
// Contract vẫn công bố 3 giá trị nên PENDING_VERIFICATION được dựng lại ở tầng mapping.
export function toContractStatus(user: {
  status: UserStatus;
  emailVerifiedAt: Date | null;
}): AccountStatus {
  if (user.status === UserStatus.LOCKED) return 'LOCKED';
  return user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
}

export function toDatabaseStatus(status: AccountStatus): UserStatus {
  return status === 'LOCKED' ? UserStatus.LOCKED : UserStatus.ACTIVE;
}

// Prisma model User kèm quan hệ cần cho AccountResponse.
export type UserWithRelations = Prisma.UserGetPayload<{ include: Record<string, never> }>;

// Id Int trả về dạng chuỗi số đúng contract (^[1-9]\d*$): dùng String(id) trực tiếp tại call site.

// Chuyển id từ chuỗi contract sang Int cho truy vấn Prisma; ném lỗi nếu không phải số dương.
export function parseContractId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
