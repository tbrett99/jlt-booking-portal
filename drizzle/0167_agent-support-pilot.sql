CREATE TABLE `agent_support_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`pilotScope` enum('admin_only','agent') NOT NULL DEFAULT 'admin_only',
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `agent_support_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_support_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`userId` int NOT NULL,
	`rating` enum('helpful','not_helpful') NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_support_feedback_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_support_feedback_message_user_unique` UNIQUE(`messageId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `agent_support_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` longtext NOT NULL,
	`responseStatus` enum('answered','insufficient_sources','failed') NOT NULL DEFAULT 'answered',
	`sourceRefs` json,
	`model` varchar(100),
	`promptTokens` int,
	`completionTokens` int,
	`contextSourceCount` int NOT NULL DEFAULT 0,
	`unresolvedReason` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_support_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `webinar_library_items` ADD `assistantTranscriptApprovedAt` timestamp;--> statement-breakpoint
ALTER TABLE `webinar_library_items` ADD `assistantTranscriptApprovedById` int;--> statement-breakpoint
CREATE INDEX `agent_support_conversations_user_updated_idx` ON `agent_support_conversations` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `agent_support_conversations_expiry_idx` ON `agent_support_conversations` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `agent_support_feedback_rating_created_idx` ON `agent_support_feedback` (`rating`,`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_support_messages_conversation_created_idx` ON `agent_support_messages` (`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_support_messages_status_created_idx` ON `agent_support_messages` (`responseStatus`,`createdAt`);