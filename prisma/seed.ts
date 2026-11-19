import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

// Seed tài khoản quản trị đầu tiên cho môi trường local.
// Idempotent: chạy lại nhiều lần không tạo trùng và không ghi đè mật khẩu đã đổi.
// Không dùng cho production — mật khẩu lấy từ SEED_ADMIN_PASSWORD, không hardcode.
const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@forher.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ADMIN_FULL_NAME = process.env.SEED_ADMIN_FULL_NAME ?? 'Quản trị For Her';

async function main(): Promise<void> {
  if (!ADMIN_PASSWORD) {
    throw new Error(
      'Missing SEED_ADMIN_PASSWORD. Set it in the shell before running the seed, never commit a real password.',
    );
  }
  if (ADMIN_PASSWORD.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters.');
  }

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log(`Admin ${email} already exists (id=${existing.id}); nothing to do.`);
    return;
  }

  const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: ADMIN_FULL_NAME,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      // Tài khoản seed là tài khoản nội bộ, không đi qua luồng xác thực email.
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true, role: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'SEED_ADMIN_CREATED',
      entityType: 'User',
      entityId: String(admin.id),
    },
  });

  console.log(`Created admin ${admin.email} (id=${admin.id}, role=${admin.role}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
