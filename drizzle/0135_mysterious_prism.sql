CREATE TABLE `public_holiday_showcase_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`showcaseId` int NOT NULL,
	`agentId` int NOT NULL,
	`action` enum('received','hidden','unpublished','reordered','expiry_set','expired') NOT NULL,
	`actorUserId` int,
	`note` varchar(500),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `public_holiday_showcase_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `public_holiday_showcases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`publicProfileId` int NOT NULL,
	`externalPublicationId` varchar(100) NOT NULL,
	`publicSlug` varchar(220) NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text NOT NULL,
	`destination` varchar(255) NOT NULL,
	`travelPeriodLabel` varchar(140),
	`durationNights` int,
	`priceMode` enum('from') DEFAULT 'from',
	`priceAmount` decimal(12,2),
	`priceCurrency` varchar(3),
	`pricePerPerson` boolean DEFAULT true,
	`heroImageUrl` text,
	`heroImageSource` enum('supplier','agent_upload'),
	`itinerary` json NOT NULL,
	`accommodationOptions` json NOT NULL,
	`inclusions` json NOT NULL,
	`practicalNotes` json NOT NULL,
	`sourceSnapshot` json NOT NULL,
	`isPublished` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp,
	`unpublishedAt` timestamp,
	`unpublishedById` int,
	`unpublishedReason` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_holiday_showcases_id` PRIMARY KEY(`id`),
	CONSTRAINT `public_holiday_showcases_externalPublicationId_unique` UNIQUE(`externalPublicationId`),
	CONSTRAINT `public_holiday_showcases_publicSlug_unique` UNIQUE(`publicSlug`)
);
--> statement-breakpoint
CREATE INDEX `public_holiday_showcase_events_showcase_idx` ON `public_holiday_showcase_events` (`showcaseId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `public_holiday_showcases_profile_visible_idx` ON `public_holiday_showcases` (`publicProfileId`,`isPublished`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `public_holiday_showcases_agent_idx` ON `public_holiday_showcases` (`agentId`,`updatedAt`);