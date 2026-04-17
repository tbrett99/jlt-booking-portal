ALTER TABLE `flight_requests` ADD `cancellationPnr` varchar(50);--> statement-breakpoint
ALTER TABLE `flight_requests` ADD `cancellationDepartureDate` timestamp;--> statement-breakpoint
ALTER TABLE `flight_requests` ADD `cancellationTicketingDeadline` timestamp;