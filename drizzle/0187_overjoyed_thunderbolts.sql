CREATE TABLE `staff_call_action_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callId` int NOT NULL,
	`participantId` int NOT NULL,
	`planId` int NOT NULL,
	`createdById` int NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_call_action_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_call_action_plan_uq` UNIQUE(`planId`)
);
--> statement-breakpoint
CREATE TABLE `staff_call_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callId` int NOT NULL,
	`participantId` int,
	`actorId` int,
	`action` varchar(80) NOT NULL,
	`beforeState` json,
	`afterState` json NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_call_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_call_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(64) NOT NULL,
	`actorId` int NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`kind` enum('book','reschedule','cancel','cancel_participant') NOT NULL,
	`callId` int NOT NULL,
	`participantId` int,
	`state` enum('pending','succeeded','needs_recovery','failed') NOT NULL DEFAULT 'pending',
	`payload` json NOT NULL,
	`result` json,
	`lastError` varchar(500),
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_call_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_call_request_uq` UNIQUE(`requestId`)
);
--> statement-breakpoint
CREATE TABLE `staff_call_participants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callId` int NOT NULL,
	`agentId` int NOT NULL,
	`attendance` enum('awaiting','attended','no_show','excused','notheld') NOT NULL DEFAULT 'awaiting',
	`outcome` enum('completed','follow_up_required','no_contact','not_held'),
	`privateNotes` text,
	`sharedSummary` text,
	`sharedAt` timestamp(3),
	`version` int NOT NULL DEFAULT 1,
	`providerSeatUid` varchar(255),
	`status` enum('active','cancelled') NOT NULL DEFAULT 'active',
	`bookedAt` timestamp(3),
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_call_participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_call_agent_uq` UNIQUE(`callId`,`agentId`),
	CONSTRAINT `staff_call_seat_uq` UNIQUE(`providerSeatUid`)
);
--> statement-breakpoint
CREATE TABLE `staff_call_webhook_inbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventKey` varchar(255) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`event` json NOT NULL,
	`state` enum('received','processed','ignored','rejected') NOT NULL DEFAULT 'received',
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`processedAt` timestamp(3),
	CONSTRAINT `staff_call_webhook_inbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_call_webhook_event_uq` UNIQUE(`eventKey`)
);
--> statement-breakpoint
CREATE TABLE `staff_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hostUserId` int NOT NULL,
	`reasonKey` varchar(64) NOT NULL,
	`reasonExplanation` varchar(1000),
	`format` enum('one_to_one','group') NOT NULL,
	`startAt` timestamp(3) NOT NULL,
	`endAt` timestamp(3) NOT NULL,
	`status` enum('pending','booked','needs_recovery','cancelled') NOT NULL DEFAULT 'pending',
	`providerBookingUid` varchar(255),
	`providerBookingId` varchar(100),
	`providerEventTypeId` varchar(100),
	`providerHostId` varchar(100),
	`meetingUrl` varchar(2000),
	`version` int NOT NULL DEFAULT 1,
	`activeOperationId` int,
	`createdById` int NOT NULL,
	`bookedAt` timestamp(3),
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_call_provider_uid_uq` UNIQUE(`providerBookingUid`)
);
--> statement-breakpoint
ALTER TABLE `staff_call_action_sources` ADD CONSTRAINT `staff_call_action_plan_fk` FOREIGN KEY (`planId`) REFERENCES `academy_action_plans`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_call_action_sources` ADD CONSTRAINT `staff_call_action_participant_fk` FOREIGN KEY (`participantId`) REFERENCES `staff_call_participants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_call_history` ADD CONSTRAINT `staff_call_history_call_fk` FOREIGN KEY (`callId`) REFERENCES `staff_calls`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_call_operations` ADD CONSTRAINT `staff_call_operation_call_fk` FOREIGN KEY (`callId`) REFERENCES `staff_calls`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_call_participants` ADD CONSTRAINT `staff_call_participant_call_fk` FOREIGN KEY (`callId`) REFERENCES `staff_calls`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `staff_call_action_source_idx` ON `staff_call_action_sources` (`callId`,`participantId`);--> statement-breakpoint
CREATE INDEX `staff_call_history_call_idx` ON `staff_call_history` (`callId`,`id`);--> statement-breakpoint
CREATE INDEX `staff_call_operation_state_idx` ON `staff_call_operations` (`state`,`createdAt`);--> statement-breakpoint
CREATE INDEX `staff_call_participant_agent_idx` ON `staff_call_participants` (`agentId`,`callId`);--> statement-breakpoint
CREATE INDEX `staff_call_webhook_state_idx` ON `staff_call_webhook_inbox` (`state`,`createdAt`);--> statement-breakpoint
CREATE INDEX `staff_call_host_time_idx` ON `staff_calls` (`hostUserId`,`startAt`);--> statement-breakpoint
CREATE INDEX `staff_call_status_idx` ON `staff_calls` (`status`,`startAt`);--> statement-breakpoint
CREATE INDEX `staff_call_booked_idx` ON `staff_calls` (`bookedAt`,`id`);