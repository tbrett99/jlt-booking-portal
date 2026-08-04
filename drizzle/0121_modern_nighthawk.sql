ALTER TABLE `flight_requests` ADD `priceIncreaseAmount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `flight_requests` ADD `priceIncreaseNote` text;--> statement-breakpoint
ALTER TABLE `flight_requests` ADD `priceIncreaseNotifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `flight_requests` ADD `priceIncreaseAcceptedAt` timestamp;--> statement-breakpoint
ALTER TABLE `flight_requests` ADD `priceIncreaseAcceptedBy` int;--> statement-breakpoint
ALTER TABLE `flight_requests` ADD `priceIncreaseDeclinedAt` timestamp;