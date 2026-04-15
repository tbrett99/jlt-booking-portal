CREATE TABLE `cached_emails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uid` varchar(128) NOT NULL,
	`subject` varchar(1000) NOT NULL DEFAULT '',
	`fromAddress` varchar(320) NOT NULL DEFAULT '',
	`fromName` varchar(255) NOT NULL DEFAULT '',
	`emailDate` timestamp NOT NULL,
	`bodyText` text,
	`bodyHtml` text,
	`snippet` varchar(500) NOT NULL DEFAULT '',
	`hasAttachments` boolean NOT NULL DEFAULT false,
	`attachmentNames` text,
	`s3Keys` text,
	`importedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cached_emails_id` PRIMARY KEY(`id`),
	CONSTRAINT `cached_emails_uid_unique` UNIQUE(`uid`)
);
--> statement-breakpoint
CREATE TABLE `imap_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`host` varchar(255) NOT NULL DEFAULT '',
	`port` int NOT NULL DEFAULT 993,
	`email` varchar(320) NOT NULL DEFAULT '',
	`passwordEncrypted` varchar(2048) NOT NULL DEFAULT '',
	`useSsl` boolean NOT NULL DEFAULT true,
	`agentAccessEnabled` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `imap_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inbox_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`guestName` varchar(255) NOT NULL,
	`departureDate` varchar(32) NOT NULL,
	`bookingReference` varchar(128),
	`resultsCount` int NOT NULL DEFAULT 0,
	`searchedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inbox_audit_logs_id` PRIMARY KEY(`id`)
);
