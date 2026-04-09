ALTER TABLE `amendments` ADD `pipelineStage` enum('To Do','In Progress','Actioned') DEFAULT 'To Do' NOT NULL;--> statement-breakpoint
ALTER TABLE `amendments` ADD `assignedToId` int;--> statement-breakpoint
ALTER TABLE `amendments` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `in_app_notifications` ADD `linkUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `refunds` ADD `pipelineStage` enum('New Refund Request','Acknowledged by Supplier','Refund Sent to PTS','Refund Received in JLT','Refund Processed') DEFAULT 'New Refund Request' NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `assignedToId` int;