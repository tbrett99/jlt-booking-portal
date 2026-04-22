CREATE TABLE `gc_payment_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`mandateId` varchar(100),
	`paymentId` varchar(100),
	`eventType` varchar(60) NOT NULL,
	`status` varchar(40),
	`amount` int,
	`currency` varchar(3) DEFAULT 'GBP',
	`failureReason` varchar(255),
	`failureDescription` varchar(512),
	`occurredAt` timestamp NOT NULL,
	`rawPayload` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gc_payment_events_id` PRIMARY KEY(`id`)
);
