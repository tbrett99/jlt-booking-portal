CREATE TABLE `competition_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitionId` int NOT NULL,
	`agentId` int NOT NULL,
	`bookingReference` varchar(100) NOT NULL,
	`bookingDate` timestamp NOT NULL,
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	`verifiedStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`verifiedById` int,
	`verifiedAt` timestamp,
	`adminNotes` varchar(500),
	CONSTRAINT `competition_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`prizeDescription` varchar(255) NOT NULL,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`status` enum('draft','active','closed') NOT NULL DEFAULT 'draft',
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `notes` ADD `isReadByAgent` boolean DEFAULT false NOT NULL;