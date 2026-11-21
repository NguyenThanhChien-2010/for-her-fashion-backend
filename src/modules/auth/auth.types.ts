import { Prisma, UserRole, UserStatus } from '@prisma/client';

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

export type UserWithRelations = Prisma.UserGetPayload<{ include: Record<string, never> }>;

export function parseContractId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
