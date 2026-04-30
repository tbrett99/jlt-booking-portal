CREATE TABLE `email_drip_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workflowId` int NOT NULL,
	`recipientEmail` varchar(320) NOT NULL,
	`recipientName` varchar(255),
	`recipientType` enum('prospect','agent') NOT NULL,
	`recipientId` int,
	`currentStep` int NOT NULL DEFAULT 0,
	`status` enum('active','completed','unsubscribed','failed') NOT NULL DEFAULT 'active',
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	`nextSendAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `email_drip_enrollments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_drip_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workflowId` int NOT NULL,
	`stepOrder` int NOT NULL DEFAULT 0,
	`delayDays` int NOT NULL DEFAULT 0,
	`subject` varchar(500) NOT NULL,
	`bodyHtml` longtext NOT NULL,
	`bodyText` text,
	`templateId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_drip_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_drip_workflows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`audienceType` enum('prospect','agent') NOT NULL DEFAULT 'prospect',
	`triggerStage` varchar(100),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_drip_workflows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`bodyHtml` longtext NOT NULL,
	`bodyText` text,
	`audienceType` enum('prospect','agent') NOT NULL DEFAULT 'prospect',
	`createdById` int,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_templates_id` PRIMARY KEY(`id`)
);
