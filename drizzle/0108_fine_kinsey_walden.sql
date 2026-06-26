ALTER TABLE `users` ADD `suspendedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `suspensionReason` varchar(255);