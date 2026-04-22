CREATE TABLE `contract_signatures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`contractTemplateId` int,
	`signedAt` timestamp NOT NULL DEFAULT (now()),
	`signatureDataUrl` mediumtext,
	`signerName` varchar(255) NOT NULL,
	`signerAddress` text,
	`ipAddress` varchar(64),
	`membershipTier` varchar(50),
	`membershipType` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contract_signatures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `join_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionToken` varchar(128) NOT NULL,
	`email` varchar(320) NOT NULL,
	`membershipTier` varchar(50),
	`membershipType` varchar(20),
	`step` varchar(30) NOT NULL DEFAULT 'plan',
	`contractSignedAt` timestamp,
	`signatureDataUrl` mediumtext,
	`signerName` varchar(255),
	`signerAddress` text,
	`billingRequestId` varchar(100),
	`billingRequestFlowUrl` text,
	`joiningFeePaidAt` timestamp,
	`mandateId` varchar(100),
	`userId` int,
	`ipAddress` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `join_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `join_sessions_sessionToken_unique` UNIQUE(`sessionToken`)
);
--> statement-breakpoint
CREATE TABLE `team_invites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`leaderId` int NOT NULL,
	`invitedEmail` varchar(320) NOT NULL,
	`token` varchar(128) NOT NULL,
	`status` enum('pending','accepted','expired') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`acceptedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_invites_token_unique` UNIQUE(`token`)
);
