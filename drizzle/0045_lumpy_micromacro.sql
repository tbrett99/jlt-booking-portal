CREATE TABLE `payment_links` (
	`id` varchar(36) NOT NULL,
	`bookingId` int NOT NULL,
	`createdById` int NOT NULL,
	`merchantId` varchar(20) NOT NULL,
	`transactionUnique` varchar(50) NOT NULL,
	`amountPence` int NOT NULL,
	`orderRef` varchar(255) NOT NULL,
	`description` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`ppsTransactionId` varchar(100),
	`ppsResponseCode` varchar(10),
	`ppsResponseMessage` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`paidAt` timestamp,
	CONSTRAINT `payment_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_bookingId_bookings_id_fk` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_createdById_users_id_fk` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;