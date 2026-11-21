import { Prisma } from '@prisma/client';

export { PrismaService } from '../../modules/prisma/prisma.service';

// Dùng chung type transaction giữa các module.
export type PrismaTransactionClient = Prisma.TransactionClient;
