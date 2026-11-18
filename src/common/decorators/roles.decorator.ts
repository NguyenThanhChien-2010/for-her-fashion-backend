import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

// Gắn danh sách role yêu cầu; RolesGuard kiểm tra metadata này sau JwtAuthGuard.
// Ví dụ: @Roles(UserRole.ADMIN) cho endpoint reports của BE-05.
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
