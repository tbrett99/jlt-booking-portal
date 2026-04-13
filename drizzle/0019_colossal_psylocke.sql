ALTER TABLE `calendar_events` ADD `recurrenceRule` enum('none','daily','weekly','monthly','yearly') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `recurrenceEndDate` timestamp;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `dueDate` timestamp;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `reminderSentAt` timestamp;