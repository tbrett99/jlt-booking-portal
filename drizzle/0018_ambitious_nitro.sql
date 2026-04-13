CREATE TABLE `calendar_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`type` enum('holiday','event','task') NOT NULL DEFAULT 'event',
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`allDay` boolean NOT NULL DEFAULT true,
	`assigneeId` int,
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `calendar_events_id` PRIMARY KEY(`id`)
);
