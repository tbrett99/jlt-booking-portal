CREATE TABLE `agent_emails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`toEmail` varchar(320) NOT NULL,
	`toName` varchar(255),
	`subject` varchar(500) NOT NULL,
	`triggerKey` varchar(100),
	`bodyHtml` mediumtext,
	`status` varchar(30) DEFAULT 'sent',
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_emails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gc_payment_failures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`consecutiveFailures` int NOT NULL DEFAULT 0,
	`lastFailedAt` timestamp,
	`autoSuspendedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gc_payment_failures_id` PRIMARY KEY(`id`)
);
