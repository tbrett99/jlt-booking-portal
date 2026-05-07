CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`keyHash` varchar(255) NOT NULL,
	`keyPrefix` varchar(10) NOT NULL,
	`agencyName` varchar(100),
	`createdById` int NOT NULL,
	`lastUsedAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `crmRef` varchar(100);