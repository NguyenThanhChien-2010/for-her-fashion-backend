-- CreateTable
CREATE TABLE `users` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `fullName` VARCHAR(150) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `role` ENUM('CUSTOMER', 'STAFF', 'ADMIN') NOT NULL DEFAULT 'CUSTOMER',
    `status` ENUM('ACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `emailVerifiedAt` DATETIME(3) NULL,
    `lockedReason` VARCHAR(255) NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    INDEX `users_role_status_idx`(`role`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `revokedAt` DATETIME(3) NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `type` ENUM('VERIFY_EMAIL', 'RESET_PASSWORD') NOT NULL,
    `tokenHash` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_tokenHash_key`(`tokenHash`),
    INDEX `auth_tokens_userId_type_idx`(`userId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `sizeChartId` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER NULL,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `categories_slug_key`(`slug`),
    INDEX `categories_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `color_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,

    UNIQUE INDEX `color_groups_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `colors` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `hex` VARCHAR(7) NULL,
    `skuSuffix` VARCHAR(10) NOT NULL,

    UNIQUE INDEX `colors_name_key`(`name`),
    UNIQUE INDEX `colors_skuSuffix_key`(`skuSuffix`),
    INDEX `colors_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `sizeChartId` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `categoryId` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(255) NOT NULL,
    `baseCode` VARCHAR(40) NOT NULL,
    `description` TEXT NULL,
    `price` DECIMAL(12, 0) NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'HIDDEN') NOT NULL DEFAULT 'DRAFT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_slug_key`(`slug`),
    UNIQUE INDEX `products_baseCode_key`(`baseCode`),
    INDEX `products_categoryId_status_idx`(`categoryId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_variants` (
    `kiotvietVariantId` VARCHAR(64) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `colorId` INTEGER NOT NULL,
    `sizeCode` VARCHAR(10) NOT NULL,
    `sku` VARCHAR(80) NOT NULL,
    `price` DECIMAL(12, 0) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `product_variants_kiotvietVariantId_key`(`kiotvietVariantId`),
    UNIQUE INDEX `product_variants_sku_key`(`sku`),
    UNIQUE INDEX `product_variants_productId_colorId_sizeCode_key`(`productId`, `colorId`, `sizeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `colorId` INTEGER NULL,
    `fileId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `product_images_productId_sortOrder_idx`(`productId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `size_chart_rows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chartId` INTEGER NOT NULL,
    `sizeCode` VARCHAR(10) NOT NULL,
    `measurements` JSON NOT NULL,

    UNIQUE INDEX `size_chart_rows_chartId_sizeCode_key`(`chartId`, `sizeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventories` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `sourceQuantity` INTEGER NULL,
    `lastConfirmedAt` DATETIME(3) NULL,
    `sourceVersion` VARCHAR(100) NULL,
    `syncStatus` ENUM('PENDING', 'CONFIRMED', 'NEEDS_RECONCILIATION') NOT NULL DEFAULT 'PENDING',
    `variantId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`variantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_movements` (
    `operationKey` VARCHAR(191) NOT NULL,
    `sourceDocumentId` VARCHAR(100) NULL,
    `inventoryVersion` INTEGER NOT NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `variantId` INTEGER NOT NULL,
    `delta` INTEGER NOT NULL,
    `reason` ENUM('ORDER_CREATED', 'ORDER_CANCELLED', 'PAYMENT_EXPIRED', 'RETURN_RECEIVED', 'ADMIN_ADJUST') NOT NULL,
    `refType` VARCHAR(30) NULL,
    `refId` INTEGER NULL,
    `note` VARCHAR(255) NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `inventory_movements_operationKey_key`(`operationKey`),
    INDEX `inventory_movements_variantId_createdAt_idx`(`variantId`, `createdAt`),
    INDEX `inventory_movements_refType_refId_idx`(`refType`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carts` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `carts_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_items` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cartId` INTEGER NOT NULL,
    `variantId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `selected` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `cart_items_cartId_variantId_key`(`cartId`, `variantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `buy_now_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `variantId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `buy_now_sessions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wishlist_items` (
    `userId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vouchers` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `discountType` ENUM('PERCENT', 'FIXED') NOT NULL,
    `discountValue` DECIMAL(12, 2) NOT NULL,
    `maxDiscount` DECIMAL(12, 0) NULL,
    `minOrderAmount` DECIMAL(12, 0) NOT NULL DEFAULT 0,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `vouchers_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `deliveryStatus` ENUM('NOT_SHIPPED', 'IN_TRANSIT', 'FAILED', 'RETURNING', 'DELIVERED', 'RETURNED') NOT NULL DEFAULT 'NOT_SHIPPED',
    `paymentExpiresAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `deliveryUnsuccessfulAt` DATETIME(3) NULL,
    `promotionType` ENUM('NONE', 'VOUCHER', 'MEMBER', 'BIRTHDAY') NOT NULL DEFAULT 'NONE',
    `promotionPercent` DECIMAL(5, 2) NULL,
    `membershipTierName` VARCHAR(60) NULL,
    `membershipPolicyVersion` INTEGER NULL,
    `checkoutQuoteId` INTEGER NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` VARCHAR(40) NOT NULL,
    `paymentMethod` ENUM('COD', 'MOMO') NOT NULL,
    `paymentStatus` ENUM('UNPAID', 'PAID', 'NEEDS_RECONCILIATION') NOT NULL DEFAULT 'UNPAID',
    `subtotal` DECIMAL(12, 0) NOT NULL,
    `shippingFee` DECIMAL(12, 0) NOT NULL DEFAULT 30000,
    `discountAmount` DECIMAL(12, 0) NOT NULL DEFAULT 0,
    `total` DECIMAL(12, 0) NOT NULL,
    `voucherId` INTEGER NULL,
    `voucherCode` VARCHAR(40) NULL,
    `shipName` VARCHAR(150) NOT NULL,
    `shipPhone` VARCHAR(20) NOT NULL,
    `shipEmail` VARCHAR(191) NOT NULL,
    `shipAddress` VARCHAR(255) NOT NULL,
    `shipWard` VARCHAR(100) NULL,
    `shipDistrict` VARCHAR(100) NULL,
    `shipProvince` VARCHAR(100) NOT NULL,
    `shipPostalCode` VARCHAR(10) NULL,
    `note` VARCHAR(500) NULL,
    `cancelReason` VARCHAR(255) NULL,
    `idempotencyKey` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_checkoutQuoteId_key`(`checkoutQuoteId`),
    UNIQUE INDEX `orders_code_key`(`code`),
    INDEX `orders_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `orders_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `orders_paymentMethod_paymentStatus_idx`(`paymentMethod`, `paymentStatus`),
    UNIQUE INDEX `orders_userId_idempotencyKey_key`(`userId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `discountAmount` DECIMAL(12, 0) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(12, 0) NOT NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `variantId` INTEGER NOT NULL,
    `productName` VARCHAR(255) NOT NULL,
    `sku` VARCHAR(80) NOT NULL,
    `colorName` VARCHAR(60) NOT NULL,
    `sizeCode` VARCHAR(10) NOT NULL,
    `unitPrice` DECIMAL(12, 0) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `lineTotal` DECIMAL(12, 0) NOT NULL,

    INDEX `order_items_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_status_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `fromStatus` VARCHAR(40) NULL,
    `toStatus` VARCHAR(40) NOT NULL,
    `source` ENUM('CUSTOMER', 'ADMIN', 'KIOTVIET', 'SYSTEM') NOT NULL,
    `actorId` INTEGER NULL,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_status_history_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `refundedAmount` DECIMAL(12, 0) NOT NULL DEFAULT 0,
    `reservedRefundAmount` DECIMAL(12, 0) NOT NULL DEFAULT 0,
    `provider` VARCHAR(30) NOT NULL,
    `providerTransactionKey` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `method` ENUM('COD', 'MOMO') NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'UNKNOWN') NOT NULL DEFAULT 'PENDING',
    `amount` DECIMAL(12, 0) NOT NULL,
    `momoOrderId` VARCHAR(64) NULL,
    `momoRequestId` VARCHAR(64) NULL,
    `momoTransId` VARCHAR(64) NULL,
    `payUrl` VARCHAR(500) NULL,
    `expiresAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `rawResponse` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_providerTransactionKey_key`(`providerTransactionKey`),
    UNIQUE INDEX `payments_momoOrderId_key`(`momoOrderId`),
    INDEX `payments_orderId_idx`(`orderId`),
    INDEX `payments_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_reconciliations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reconDate` DATE NOT NULL,
    `expectedCount` INTEGER NOT NULL,
    `expectedTotal` DECIMAL(14, 0) NOT NULL,
    `actualCount` INTEGER NOT NULL,
    `actualTotal` DECIMAL(14, 0) NOT NULL,
    `status` ENUM('MATCHED', 'MISMATCHED') NOT NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_reconciliations_reconDate_key`(`reconDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kiotviet_order_links` (
    `orderId` INTEGER NOT NULL,
    `kiotvietOrderId` VARCHAR(64) NULL,
    `kiotvietCode` VARCHAR(64) NULL,
    `lastKvStatus` VARCHAR(40) NULL,
    `lastSyncedAt` DATETIME(3) NULL,

    UNIQUE INDEX `kiotviet_order_links_kiotvietOrderId_key`(`kiotvietOrderId`),
    PRIMARY KEY (`orderId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kiotviet_status_mappings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kiotvietStatus` VARCHAR(40) NOT NULL,
    `orderStatus` VARCHAR(40) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `kiotviet_status_mappings_kiotvietStatus_key`(`kiotvietStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_outbox` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `type` ENUM('PUSH_ORDER', 'SYNC_STATUS', 'SYNC_INVENTORY', 'SYNC_PAYMENT', 'SYNC_RETURN', 'SYNC_CUSTOMER', 'SYNC_INVOICE') NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextRetryAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sync_outbox_idempotencyKey_key`(`idempotencyKey`),
    INDEX `sync_outbox_status_nextRetryAt_idx`(`status`, `nextRetryAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NULL,
    `direction` ENUM('OUTBOUND', 'INBOUND') NOT NULL,
    `endpoint` VARCHAR(150) NULL,
    `request` JSON NULL,
    `response` JSON NULL,
    `httpStatus` INTEGER NULL,
    `success` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sync_logs_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_tiers` (
    `regularDiscountPercent` DECIMAL(5, 2) NOT NULL,
    `birthdayDiscountPercent` DECIMAL(5, 2) NOT NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `minSpent` DECIMAL(14, 0) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `membership_tiers_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `verifiedPhone` VARCHAR(20) NULL,
    `sourceCustomerId` VARCHAR(100) NULL,
    `dateOfBirth` DATE NULL,
    `dateOfBirthVerifiedAt` DATETIME(3) NULL,
    `sourceSyncStatus` ENUM('PENDING', 'CONFIRMED', 'NEEDS_RECONCILIATION') NOT NULL DEFAULT 'PENDING',
    `sourceLastSyncedAt` DATETIME(3) NULL,
    `accumulatedTierId` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NULL,
    `tierId` INTEGER NULL,
    `totalSpent` DECIMAL(14, 0) NOT NULL DEFAULT 0,
    `points` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `member_profiles_verifiedPhone_key`(`verifiedPhone`),
    UNIQUE INDEX `member_profiles_sourceCustomerId_key`(`sourceCustomerId`),
    UNIQUE INDEX `member_profiles_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loyalty_entries` (
    `memberProfileId` INTEGER NOT NULL,
    `sourceSystem` VARCHAR(30) NOT NULL,
    `sourceEventKey` VARCHAR(191) NOT NULL,
    `sourceInvoiceId` VARCHAR(100) NULL,
    `sourceChannel` VARCHAR(30) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `returnReceiptId` INTEGER NULL,
    `tierBefore` VARCHAR(60) NULL,
    `tierAfter` VARCHAR(60) NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `orderId` INTEGER NULL,
    `type` ENUM('EARN', 'REVERSE', 'ADJUST') NOT NULL,
    `spentDelta` DECIMAL(14, 0) NOT NULL,
    `pointsDelta` INTEGER NOT NULL,
    `balanceSpent` DECIMAL(14, 0) NOT NULL,
    `balancePoints` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `loyalty_entries_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `loyalty_entries_sourceSystem_sourceEventKey_key`(`sourceSystem`, `sourceEventKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `rating` TINYINT NOT NULL,
    `content` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reviews_orderItemId_key`(`orderItemId`),
    INDEX `reviews_productId_status_idx`(`productId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reviewId` INTEGER NOT NULL,
    `fileId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `review_images_reviewId_idx`(`reviewId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_rating_stats` (
    `productId` INTEGER NOT NULL,
    `avgRating` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `star1` INTEGER NOT NULL DEFAULT 0,
    `star2` INTEGER NOT NULL DEFAULT 0,
    `star3` INTEGER NOT NULL DEFAULT 0,
    `star4` INTEGER NOT NULL DEFAULT 0,
    `star5` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_requests` (
    `activeSlot` INTEGER NULL DEFAULT 1,
    `requestType` ENUM('REFUND', 'EXCHANGE') NOT NULL DEFAULT 'REFUND',
    `kiotReturnDocumentId` VARCHAR(100) NULL,
    `replacementKiotOrderId` VARCHAR(100) NULL,
    `completedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `orderId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `reason` VARCHAR(500) NOT NULL,
    `adminNote` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `return_requests_code_key`(`code`),
    INDEX `return_requests_orderId_idx`(`orderId`),
    INDEX `return_requests_status_createdAt_idx`(`status`, `createdAt`),
    UNIQUE INDEX `return_requests_orderId_activeSlot_key`(`orderId`, `activeSlot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_request_items` (
    `approvedQuantity` INTEGER NOT NULL DEFAULT 0,
    `receivedQuantity` INTEGER NOT NULL DEFAULT 0,
    `acceptedQuantity` INTEGER NOT NULL DEFAULT 0,
    `resalableQuantity` INTEGER NOT NULL DEFAULT 0,
    `reservedQuantity` INTEGER NOT NULL DEFAULT 0,
    `refundedNetAmount` DECIMAL(12, 0) NOT NULL DEFAULT 0,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,

    INDEX `return_request_items_orderItemId_idx`(`orderItemId`),
    UNIQUE INDEX `return_request_items_requestId_orderItemId_key`(`requestId`, `orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_request_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `fileId` INTEGER NOT NULL,

    INDEX `return_request_images_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `fromStatus` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED', 'CANCELLED') NULL,
    `toStatus` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED', 'CANCELLED') NOT NULL,
    `actorId` INTEGER NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `return_history_requestId_createdAt_idx`(`requestId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tailoring_requests` (
    `garmentType` VARCHAR(150) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `kiotOrderId` VARCHAR(100) NULL,
    `kiotOrderCode` VARCHAR(100) NULL,
    `kiotLinkVerifiedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'QUOTED', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'NEW',
    `fullName` VARCHAR(150) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `email` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tailoring_requests_code_key`(`code`),
    INDEX `tailoring_requests_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tailoring_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `fromStatus` ENUM('NEW', 'CONTACTED', 'QUOTED', 'DONE', 'CANCELLED') NULL,
    `toStatus` ENUM('NEW', 'CONTACTED', 'QUOTED', 'DONE', 'CANCELLED') NOT NULL,
    `actorId` INTEGER NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tailoring_history_requestId_createdAt_idx`(`requestId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_templates` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(60) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `variables` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_templates_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_logs` (
    `subjectSnapshot` VARCHAR(255) NOT NULL,
    `bodySnapshot` TEXT NOT NULL,
    `templateVersion` INTEGER NULL,
    `queuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attemptedAt` DATETIME(3) NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NULL,
    `event` VARCHAR(60) NOT NULL,
    `toEmail` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `refType` VARCHAR(30) NULL,
    `refId` INTEGER NULL,
    `status` ENUM('SENT', 'FAILED') NOT NULL,
    `error` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,

    INDEX `notification_logs_refType_refId_idx`(`refType`, `refId`),
    INDEX `notification_logs_status_sentAt_idx`(`status`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files` (
    `purpose` VARCHAR(40) NOT NULL,
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `storageKey` VARCHAR(255) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `uploadedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `files_storageKey_key`(`storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(60) NOT NULL,
    `entityId` VARCHAR(60) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_configs` (
    `version` INTEGER NOT NULL DEFAULT 1,
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updatedBy` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(128) NOT NULL,
    `subjectKey` VARCHAR(100) NOT NULL,
    `state` VARCHAR(30) NOT NULL DEFAULT 'PROCESSING',
    `resourceId` VARCHAR(100) NULL,
    `scope` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NULL,
    `response` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idempotency_keys_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `idempotency_keys_subjectKey_scope_key_key`(`subjectKey`, `scope`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_outbox` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `eventType` VARCHAR(60) NOT NULL,
    `aggregateType` VARCHAR(40) NOT NULL,
    `aggregateId` VARCHAR(40) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    INDEX `event_outbox_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `refreshTokenHash` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `rotatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `auth_sessions_refreshTokenHash_key`(`refreshTokenHash`),
    INDEX `auth_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sizes` (
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `skuSuffix` VARCHAR(10) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `sizes_skuSuffix_key`(`skuSuffix`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `size_charts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `unit` VARCHAR(10) NOT NULL DEFAULT 'cm',
    `version` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pending_inventory_effects` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `variantId` INTEGER NOT NULL,
    `orderId` INTEGER NULL,
    `operationKey` VARCHAR(191) NOT NULL,
    `delta` INTEGER NOT NULL,
    `sourceDocumentId` VARCHAR(100) NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'NEEDS_RECONCILIATION') NOT NULL DEFAULT 'PENDING',
    `sourceAcknowledgedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pending_inventory_effects_operationKey_key`(`operationKey`),
    INDEX `pending_inventory_effects_variantId_status_idx`(`variantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `variantId` INTEGER NOT NULL,
    `expectedVersion` INTEGER NOT NULL,
    `requestedQuantity` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `actorId` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'NEEDS_RECONCILIATION') NOT NULL DEFAULT 'PENDING',
    `operationKey` VARCHAR(191) NOT NULL,
    `sourceDocumentId` VARCHAR(100) NULL,
    `sourceVersion` VARCHAR(100) NULL,
    `resultQuantity` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,

    UNIQUE INDEX `inventory_adjustments_operationKey_key`(`operationKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_summaries` (
    `orderId` INTEGER NOT NULL,
    `status` ENUM('UNPAID', 'PAID', 'NEEDS_RECONCILIATION') NOT NULL DEFAULT 'UNPAID',
    `paidAmount` DECIMAL(14, 0) NOT NULL DEFAULT 0,
    `refundedAmount` DECIMAL(14, 0) NOT NULL DEFAULT 0,
    `reservedRefundAmount` DECIMAL(14, 0) NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`orderId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `paymentId` INTEGER NOT NULL,
    `returnRequestId` INTEGER NULL,
    `basisType` ENUM('CANCELLATION', 'RETURN', 'OVERPAYMENT') NOT NULL,
    `basisKey` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 0) NOT NULL,
    `reservedAmount` DECIMAL(12, 0) NOT NULL DEFAULT 0,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'NEEDS_RECONCILIATION') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `reason` VARCHAR(500) NOT NULL,
    `requestedBy` INTEGER NULL,
    `approvedBy` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refunds_basisKey_key`(`basisKey`),
    INDEX `refunds_paymentId_status_idx`(`paymentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund_attempts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `refundId` INTEGER NOT NULL,
    `attemptNo` INTEGER NOT NULL,
    `momoRefundOrderId` VARCHAR(64) NULL,
    `momoRequestId` VARCHAR(64) NULL,
    `momoOriginalTransId` VARCHAR(64) NULL,
    `momoRefundTransId` VARCHAR(64) NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'UNKNOWN') NOT NULL DEFAULT 'PENDING',
    `amount` DECIMAL(12, 0) NOT NULL,
    `requestSnapshot` JSON NULL,
    `sentAt` DATETIME(3) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `resultCode` VARCHAR(60) NULL,
    `rawResponse` JSON NULL,
    `evidenceFileId` INTEGER NULL,
    `manualConfirmedBy` INTEGER NULL,
    `manualConfirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refund_attempts_momoRefundOrderId_key`(`momoRefundOrderId`),
    UNIQUE INDEX `refund_attempts_momoRequestId_key`(`momoRequestId`),
    UNIQUE INDEX `refund_attempts_refundId_attemptNo_key`(`refundId`, `attemptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `refundId` INTEGER NOT NULL,
    `attemptId` INTEGER NULL,
    `action` VARCHAR(60) NOT NULL,
    `actorId` INTEGER NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refund_history_refundId_createdAt_idx`(`refundId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_reconciliation_cases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentId` INTEGER NOT NULL,
    `caseKey` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `resolution` TEXT NULL,
    `resolvedBy` INTEGER NULL,
    `resolvedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_reconciliation_cases_caseKey_key`(`caseKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_policies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `version` INTEGER NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `birthdayDaysBefore` INTEGER NOT NULL DEFAULT 15,
    `birthdayDaysAfter` INTEGER NOT NULL DEFAULT 15,
    `unrankedBirthdayThreshold` DECIMAL(14, 0) NOT NULL DEFAULT 3000000,
    `unrankedBirthdayPercent` DECIMAL(5, 2) NOT NULL DEFAULT 10,
    `tierRules` JSON NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `membership_policies_version_key`(`version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `birthday_usages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `profileId` INTEGER NOT NULL,
    `birthdayYear` INTEGER NOT NULL,
    `orderId` INTEGER NULL,
    `sourceInvoiceId` VARCHAR(100) NULL,
    `status` ENUM('HELD', 'USED', 'RELEASED', 'PENDING_VERIFICATION') NOT NULL DEFAULT 'HELD',
    `activeSlot` INTEGER NULL DEFAULT 1,
    `heldAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `birthday_usages_orderId_key`(`orderId`),
    UNIQUE INDEX `birthday_usages_profileId_birthdayYear_activeSlot_key`(`profileId`, `birthdayYear`, `activeSlot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `operationKey` VARCHAR(191) NOT NULL,
    `kiotDocumentId` VARCHAR(100) NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `actorId` INTEGER NOT NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `return_receipts_operationKey_key`(`operationKey`),
    INDEX `return_receipts_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_receipt_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `requestItemId` INTEGER NOT NULL,
    `receivedQuantity` INTEGER NOT NULL,
    `acceptedQuantity` INTEGER NOT NULL,
    `resalableQuantity` INTEGER NOT NULL,
    `netAmountDelta` DECIMAL(12, 0) NOT NULL,

    UNIQUE INDEX `return_receipt_items_receiptId_requestItemId_key`(`receiptId`, `requestItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_return_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `kiotDocumentId` VARCHAR(100) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `actorId` INTEGER NULL,

    UNIQUE INDEX `delivery_return_receipts_sourceKey_key`(`sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_return_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `receivedQuantity` INTEGER NOT NULL,
    `resalableQuantity` INTEGER NOT NULL,

    UNIQUE INDEX `delivery_return_items_receiptId_orderItemId_key`(`receiptId`, `orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `checkout_contexts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `items` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `checkout_quotes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contextId` INTEGER NOT NULL,
    `subtotal` DECIMAL(12, 0) NOT NULL,
    `discountAmount` DECIMAL(12, 0) NOT NULL,
    `shippingFee` DECIMAL(12, 0) NOT NULL,
    `totalAmount` DECIMAL(12, 0) NOT NULL,
    `promotionSnapshot` JSON NOT NULL,
    `itemsSnapshot` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `source_invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sourceSystem` VARCHAR(30) NOT NULL,
    `sourceInvoiceId` VARCHAR(100) NOT NULL,
    `sourceCustomerId` VARCHAR(100) NOT NULL,
    `channel` VARCHAR(30) NOT NULL,
    `memberProfileId` INTEGER NULL,
    `webOrderId` INTEGER NULL,
    `eligibleRevenue` DECIMAL(14, 0) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `sourceVersion` VARCHAR(100) NULL,
    `payload` JSON NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `source_invoices_memberProfileId_occurredAt_idx`(`memberProfileId`, `occurredAt`),
    UNIQUE INDEX `source_invoices_sourceSystem_sourceInvoiceId_key`(`sourceSystem`, `sourceInvoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_template_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `variables` JSON NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notification_template_versions_templateId_version_key`(`templateId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_sizeChartId_fkey` FOREIGN KEY (`sizeChartId`) REFERENCES `size_charts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `colors` ADD CONSTRAINT `colors_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `color_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_sizeChartId_fkey` FOREIGN KEY (`sizeChartId`) REFERENCES `size_charts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_sizeCode_fkey` FOREIGN KEY (`sizeCode`) REFERENCES `sizes`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_colorId_fkey` FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_colorId_fkey` FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_chart_rows` ADD CONSTRAINT `size_chart_rows_chartId_fkey` FOREIGN KEY (`chartId`) REFERENCES `size_charts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_chart_rows` ADD CONSTRAINT `size_chart_rows_sizeCode_fkey` FOREIGN KEY (`sizeCode`) REFERENCES `sizes`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventories` ADD CONSTRAINT `inventories_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carts` ADD CONSTRAINT `carts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_cartId_fkey` FOREIGN KEY (`cartId`) REFERENCES `carts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `buy_now_sessions` ADD CONSTRAINT `buy_now_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `buy_now_sessions` ADD CONSTRAINT `buy_now_sessions_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wishlist_items` ADD CONSTRAINT `wishlist_items_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wishlist_items` ADD CONSTRAINT `wishlist_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_checkoutQuoteId_fkey` FOREIGN KEY (`checkoutQuoteId`) REFERENCES `checkout_quotes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `vouchers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kiotviet_order_links` ADD CONSTRAINT `kiotviet_order_links_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_outbox` ADD CONSTRAINT `sync_outbox_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_logs` ADD CONSTRAINT `sync_logs_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_profiles` ADD CONSTRAINT `member_profiles_accumulatedTierId_fkey` FOREIGN KEY (`accumulatedTierId`) REFERENCES `membership_tiers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_profiles` ADD CONSTRAINT `member_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_profiles` ADD CONSTRAINT `member_profiles_tierId_fkey` FOREIGN KEY (`tierId`) REFERENCES `membership_tiers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_entries` ADD CONSTRAINT `loyalty_entries_memberProfileId_fkey` FOREIGN KEY (`memberProfileId`) REFERENCES `member_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_entries` ADD CONSTRAINT `loyalty_entries_returnReceiptId_fkey` FOREIGN KEY (`returnReceiptId`) REFERENCES `return_receipts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_entries` ADD CONSTRAINT `loyalty_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_entries` ADD CONSTRAINT `loyalty_entries_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_images` ADD CONSTRAINT `review_images_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_images` ADD CONSTRAINT `review_images_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_rating_stats` ADD CONSTRAINT `product_rating_stats_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_requests` ADD CONSTRAINT `return_requests_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_requests` ADD CONSTRAINT `return_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_request_items` ADD CONSTRAINT `return_request_items_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `return_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_request_items` ADD CONSTRAINT `return_request_items_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_request_images` ADD CONSTRAINT `return_request_images_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `return_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_request_images` ADD CONSTRAINT `return_request_images_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_history` ADD CONSTRAINT `return_history_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `return_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tailoring_requests` ADD CONSTRAINT `tailoring_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tailoring_history` ADD CONSTRAINT `tailoring_history_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `tailoring_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_logs` ADD CONSTRAINT `notification_logs_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `notification_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pending_inventory_effects` ADD CONSTRAINT `pending_inventory_effects_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pending_inventory_effects` ADD CONSTRAINT `pending_inventory_effects_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_adjustments` ADD CONSTRAINT `inventory_adjustments_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_summaries` ADD CONSTRAINT `payment_summaries_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_returnRequestId_fkey` FOREIGN KEY (`returnRequestId`) REFERENCES `return_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_attempts` ADD CONSTRAINT `refund_attempts_refundId_fkey` FOREIGN KEY (`refundId`) REFERENCES `refunds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_attempts` ADD CONSTRAINT `refund_attempts_evidenceFileId_fkey` FOREIGN KEY (`evidenceFileId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_history` ADD CONSTRAINT `refund_history_refundId_fkey` FOREIGN KEY (`refundId`) REFERENCES `refunds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_history` ADD CONSTRAINT `refund_history_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `refund_attempts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_reconciliation_cases` ADD CONSTRAINT `payment_reconciliation_cases_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `birthday_usages` ADD CONSTRAINT `birthday_usages_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `member_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `birthday_usages` ADD CONSTRAINT `birthday_usages_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_receipts` ADD CONSTRAINT `return_receipts_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `return_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_receipt_items` ADD CONSTRAINT `return_receipt_items_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `return_receipts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_receipt_items` ADD CONSTRAINT `return_receipt_items_requestItemId_fkey` FOREIGN KEY (`requestItemId`) REFERENCES `return_request_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_return_receipts` ADD CONSTRAINT `delivery_return_receipts_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_return_items` ADD CONSTRAINT `delivery_return_items_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `delivery_return_receipts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_return_items` ADD CONSTRAINT `delivery_return_items_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_contexts` ADD CONSTRAINT `checkout_contexts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_quotes` ADD CONSTRAINT `checkout_quotes_contextId_fkey` FOREIGN KEY (`contextId`) REFERENCES `checkout_contexts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_invoices` ADD CONSTRAINT `source_invoices_memberProfileId_fkey` FOREIGN KEY (`memberProfileId`) REFERENCES `member_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_invoices` ADD CONSTRAINT `source_invoices_webOrderId_fkey` FOREIGN KEY (`webOrderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_template_versions` ADD CONSTRAINT `notification_template_versions_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `notification_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
