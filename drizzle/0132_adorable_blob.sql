CREATE TABLE `commission_readiness_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`agentId` int NOT NULL,
	`departureDate` timestamp NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commission_readiness_reminders_id` PRIMARY KEY(`id`),
	CONSTRAINT `commission_readiness_booking_departure_unique` UNIQUE(`bookingId`,`departureDate`)
);
