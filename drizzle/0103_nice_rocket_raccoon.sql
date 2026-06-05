ALTER TABLE `amendments` MODIFY COLUMN `status` enum('pending','actioned','rejected') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `amendments` ADD `rejectionReason` text;--> statement-breakpoint
ALTER TABLE `amendments` ADD `rejectedAt` timestamp;--> statement-breakpoint
ALTER TABLE `amendments` ADD `rejectedById` int;