CREATE TABLE `flight_request_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightRequestId` int NOT NULL,
	`bookingId` int NOT NULL,
	`action` varchar(50) NOT NULL,
	`previousStatus` varchar(50),
	`newStatus` varchar(50),
	`performedById` int,
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flight_request_actions_id` PRIMARY KEY(`id`)
);
