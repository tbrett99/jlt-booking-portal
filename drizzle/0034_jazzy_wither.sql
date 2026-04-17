CREATE TABLE `agent_status_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fromStatus` varchar(50),
	`toStatus` varchar(50) NOT NULL,
	`adminId` int NOT NULL,
	`notes` text,
	`pauseEndsAt` timestamp,
	`noticeEndsAt` timestamp,
	`cancelledAt` timestamp,
	`cancelChecklist` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_status_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `teamId` int;--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `pauseEndsAt` timestamp;--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `noticeEndsAt` timestamp;--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `cancelledAt` timestamp;--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `suspendedAt` timestamp;