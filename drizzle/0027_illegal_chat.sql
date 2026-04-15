CREATE TABLE `booking_email_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`cachedEmailId` int NOT NULL,
	`linkedBy` int NOT NULL,
	`note` varchar(500),
	`linkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `booking_email_links_id` PRIMARY KEY(`id`)
);
