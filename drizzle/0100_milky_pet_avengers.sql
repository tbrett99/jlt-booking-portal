CREATE TABLE `event_registrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`userId` int NOT NULL,
	`registeredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_registrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `agentFacing` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `eventUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `eventCategory` enum('training','webinar','supplier_event');--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `duration` int DEFAULT 60;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `registrationEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `agentReminderSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `communityPostId` int;