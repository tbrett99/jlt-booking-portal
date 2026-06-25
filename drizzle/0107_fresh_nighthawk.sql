ALTER TABLE `bookings` ADD `reducedMarginApproved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `reducedMarginEvidenceUrl` text;--> statement-breakpoint
ALTER TABLE `bookings` ADD `reducedMarginApprovedAt` timestamp;--> statement-breakpoint
ALTER TABLE `bookings` ADD `reducedMarginApprovedById` int;