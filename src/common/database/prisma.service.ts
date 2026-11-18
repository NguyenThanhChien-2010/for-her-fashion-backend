import { Prisma } from '@prisma/client';

// Adapter mỏng: PrismaService là của Leader (src/modules/prisma) và là nguồn duy nhất.
// File này chỉ tái xuất để tầng common/M01 không phụ thuộc đường dẫn cụ thể của Leader.
export { PrismaService } from '../../modules/prisma/prisma.service';

// Transaction client dùng khi service domain cần tham gia transaction của module khác.
export type PrismaTransactionClient = Prisma.TransactionClient;
