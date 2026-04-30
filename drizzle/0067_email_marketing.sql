CREATE TABLE `email_sends` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int,
	`dripStepId` int,
	`enrollmentId` int,
	`recipientEmail` varchar(320) NOT NULL,
	`recipientName` varchar(255),
	`recipientType` enum('prospect','agent') NOT NULL,
	`recipientId` int,
	`subject` varchar(500) NOT NULL,
	`resendMessageId` varchar(255),
	`status` enum('queued','sent','delivered','opened','clicked','bounced','complained','failed') NOT NULL DEFAULT 'queued',
	`sentAt` timestamp,
	`deliveredAt` timestamp,
	`openedAt` timestamp,
	`clickedAt` timestamp,
	`bouncedAt` timestamp,
	`failedReason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_sends_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP TABLE `campaign_sends`;--> statement-breakpoint
ALTER TABLE `email_campaigns` MODIFY COLUMN `bodyHtml` longtext NOT NULL;--> statement-breakpoint
ALTER TABLE `email_campaigns` MODIFY COLUMN `status` enum('draft','sending','sent','failed') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `email_campaigns` MODIFY COLUMN `createdById` int;--> statement-breakpoint
ALTER TABLE `email_campaigns` ADD `audienceType` enum('prospect','agent') DEFAULT 'prospect' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_campaigns` ADD `segmentFilters` text;--> statement-breakpoint
ALTER TABLE `email_campaigns` ADD `bodyText` text;--> statement-breakpoint
ALTER TABLE `email_campaigns` ADD `templateId` int;--> statement-breakpoint
ALTER TABLE `email_campaigns` ADD `totalRecipients` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `email_campaigns` ADD `sentById` int;--> statement-breakpoint
ALTER TABLE `email_campaigns` ADD `sentByName` varchar(128);--> statement-breakpoint
ALTER TABLE `email_campaigns` DROP COLUMN `segmentType`;--> statement-breakpoint
ALTER TABLE `email_campaigns` DROP COLUMN `sentCount`;