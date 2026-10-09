ALTER TABLE `gc_payment_events` ADD `gocardlessEventId` varchar(100);--> statement-breakpoint
ALTER TABLE `gc_payment_failures` ADD `notifiedFailureCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `gc_payment_failures` ADD `lastFailureNoticeAt` timestamp;--> statement-breakpoint
ALTER TABLE `gc_payment_failures` ADD `failureRunResetAt` timestamp;--> statement-breakpoint
ALTER TABLE `gc_payment_events` ADD CONSTRAINT `gc_payment_events_gocardlessEventId_unique` UNIQUE(`gocardlessEventId`);