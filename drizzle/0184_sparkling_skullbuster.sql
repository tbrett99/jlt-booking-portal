CREATE TABLE `staff_work_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventKey` varchar(255) NOT NULL,
	`domain` varchar(20) NOT NULL,
	`requestId` int NOT NULL,
	`bookingId` int,
	`eventType` varchar(50) NOT NULL,
	`beforeStatus` varchar(50),
	`afterStatus` varchar(50),
	`actorId` int,
	`actorRole` varchar(32),
	`actorName` varchar(255),
	`occurredAt` timestamp NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	`requestType` varchar(32),
	`sourceEventId` int,
	`receivedAt` timestamp,
	`metadata` json,
	CONSTRAINT `staff_work_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_work_events_event_key_unique` UNIQUE(`eventKey`)
);
--> statement-breakpoint
CREATE INDEX `staff_work_events_time_idx` ON `staff_work_events` (`occurredAt`);--> statement-breakpoint
CREATE INDEX `staff_work_events_domain_time_idx` ON `staff_work_events` (`domain`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `staff_work_events_entity_idx` ON `staff_work_events` (`domain`,`requestId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `staff_work_events_booking_idx` ON `staff_work_events` (`bookingId`);