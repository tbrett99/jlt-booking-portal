CREATE TABLE `terms_signings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`termsVersionId` int NOT NULL,
	`userId` int NOT NULL,
	`signedName` varchar(200) NOT NULL,
	`ipAddress` varchar(45),
	`userAgent` varchar(500),
	`signedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `terms_signings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `terms_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`versionLabel` varchar(50) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT false,
	`sentAt` timestamp,
	`sentById` int,
	`deadline` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `terms_versions_id` PRIMARY KEY(`id`)
);
