ALTER TABLE `public_holiday_showcase_events` MODIFY COLUMN `action` enum('received','hidden','unpublished','reordered','expiry_set','expired','deleted') NOT NULL;--> statement-breakpoint
ALTER TABLE `public_holiday_showcases` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `public_holiday_showcases` ADD `deletedById` int;