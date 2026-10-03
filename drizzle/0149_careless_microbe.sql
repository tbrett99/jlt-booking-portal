CREATE TABLE `consumer_support_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customerName` varchar(255) NOT NULL,
	`customerEmail` varchar(320) NOT NULL,
	`customerPhone` varchar(40),
	`bookingReference` varchar(120),
	`agentOrBusinessName` varchar(255),
	`departureDate` timestamp,
	`message` text NOT NULL,
	`consentConfirmedAt` timestamp NOT NULL,
	`ipHash` varchar(128) NOT NULL,
	`status` enum('new','in_progress','resolved') NOT NULL DEFAULT 'new',
	`assignedToId` int,
	`resolvedAt` timestamp,
	`resolvedById` int,
	`internalNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consumer_support_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `public_site_settings` (
	`key` varchar(100) NOT NULL,
	`value` json NOT NULL,
	`updatedById` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_site_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE INDEX `consumer_support_cases_status_idx` ON `consumer_support_cases` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `consumer_support_cases_ip_rate_limit_idx` ON `consumer_support_cases` (`ipHash`,`createdAt`);