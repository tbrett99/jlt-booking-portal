ALTER TABLE `admin_tasks` ADD `sourceNoteId` int;--> statement-breakpoint
ALTER TABLE `admin_tasks` ADD `createdFrom` enum('manual','booking_mention') DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_tasks` ADD `acknowledgedAt` timestamp;--> statement-breakpoint
ALTER TABLE `admin_tasks` ADD `acknowledgedById` int;--> statement-breakpoint
ALTER TABLE `admin_tasks` ADD `completedAt` timestamp;--> statement-breakpoint
ALTER TABLE `admin_tasks` ADD `completedById` int;