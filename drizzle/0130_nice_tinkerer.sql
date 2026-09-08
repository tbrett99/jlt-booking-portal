CREATE TABLE `pts_booking_export_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`exportedById` int NOT NULL,
	`rowCount` int NOT NULL,
	`csvContent` longtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pts_booking_export_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pts_booking_export_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`exportBatchId` int NOT NULL,
	`bookingId` int NOT NULL,
	`exportedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pts_booking_export_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `pts_booking_export_items_bookingId_unique` UNIQUE(`bookingId`)
);
