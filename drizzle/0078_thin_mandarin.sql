CREATE TABLE `oauth_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`clientId` varchar(64) NOT NULL,
	`clientSecretHash` varchar(255) NOT NULL,
	`clientSecretPrefix` varchar(10) NOT NULL,
	`redirectUri` varchar(500) NOT NULL,
	`logoUrl` varchar(500),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oauth_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_clients_clientId_unique` UNIQUE(`clientId`)
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(128) NOT NULL,
	`clientId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`redirectUri` varchar(500) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oauth_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_codes_code_unique` UNIQUE(`code`)
);
