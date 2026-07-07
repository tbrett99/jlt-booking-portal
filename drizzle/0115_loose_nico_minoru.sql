CREATE TABLE `fnf_voucher_allocations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`totalGranted` int NOT NULL DEFAULT 2,
	`renewsAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`createdById` int,
	`note` varchar(255),
	CONSTRAINT `fnf_voucher_allocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fnf_voucher_uses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`allocationId` int NOT NULL,
	`agentId` int NOT NULL,
	`bookingId` int NOT NULL,
	`appliedAt` timestamp NOT NULL DEFAULT (now()),
	`appliedById` int NOT NULL,
	`removedAt` timestamp,
	`removedById` int,
	CONSTRAINT `fnf_voucher_uses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `fnfVoucherUsed` boolean DEFAULT false NOT NULL;