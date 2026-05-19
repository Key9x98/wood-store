-- CreateTable
CREATE TABLE `site_products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `short_description` TEXT NULL,
    `description` TEXT NOT NULL,
    `regular_price` INTEGER NOT NULL,
    `sale_price` INTEGER NULL,
    `sale_percent` INTEGER NOT NULL DEFAULT 0,
    `video_url` TEXT NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `attributes` JSON NOT NULL,
    `categories` JSON NOT NULL,
    `images` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `wp_post_id` INTEGER NULL,
    `sync_status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `sync_error` TEXT NULL,
    `synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `site_products_site_id_sync_status_idx`(`site_id`, `sync_status`),
    UNIQUE INDEX `site_products_site_id_slug_key`(`site_id`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_media` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `source_url` TEXT NOT NULL,
    `url_hash` CHAR(64) NOT NULL,
    `wp_attachment_id` INTEGER NULL,
    `wp_url` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `site_media_site_id_url_hash_key`(`site_id`, `url_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `site_products` ADD CONSTRAINT `site_products_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_media` ADD CONSTRAINT `site_media_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

