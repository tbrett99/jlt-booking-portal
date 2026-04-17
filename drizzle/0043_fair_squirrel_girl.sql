CREATE TABLE `flight_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`agentId` int NOT NULL,
	`requestType` varchar(20) NOT NULL,
	`supplier` varchar(50) NOT NULL,
	`pnr` varchar(50) NOT NULL,
	`departureDate` timestamp NOT NULL,
	`ticketingDeadline` timestamp NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`invoiceAddedToPts` boolean NOT NULL DEFAULT false,
	`queryMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flight_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `flight_requests` ADD CONSTRAINT `flight_requests_bookingId_bookings_id_fk` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flight_requests` ADD CONSTRAINT `flight_requests_agentId_users_id_fk` FOREIGN KEY (`agentId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;