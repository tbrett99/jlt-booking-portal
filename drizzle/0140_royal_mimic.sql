CREATE TABLE `public_holiday_showcase_edit_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`showcaseId` int NOT NULL,
	`agentId` int NOT NULL,
	`status` enum('pending','approved','changes_requested','rejected') NOT NULL DEFAULT 'pending',
	`draft` json NOT NULL,
	`agentNote` varchar(500),
	`reviewNote` varchar(500),
	`reviewedById` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_holiday_showcase_edit_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `public_holiday_showcase_events` MODIFY COLUMN `action` enum('received','hidden','unpublished','reordered','expiry_set','expired','deleted','edit_submitted','edit_approved','edit_rejected') NOT NULL;--> statement-breakpoint
ALTER TABLE `public_holiday_showcases` ADD `editorialTags` json;--> statement-breakpoint
CREATE INDEX `public_holiday_showcase_edit_requests_showcase_idx` ON `public_holiday_showcase_edit_requests` (`showcaseId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `public_holiday_showcase_edit_requests_status_idx` ON `public_holiday_showcase_edit_requests` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `public_holiday_showcase_edit_requests_agent_idx` ON `public_holiday_showcase_edit_requests` (`agentId`,`createdAt`);