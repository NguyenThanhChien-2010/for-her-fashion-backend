import { SetMetadata } from '@nestjs/common';

// Đánh dấu endpoint không cần JWT; JwtAuthGuard đọc metadata này để bypass.
// Ví dụ: @Public() @Get('products') trong CatalogModule.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(IS_PUBLIC_KEY, true);
