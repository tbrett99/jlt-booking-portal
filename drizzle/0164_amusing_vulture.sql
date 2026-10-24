CREATE TABLE `knowledge_base_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`contentHtml` longtext,
	`category` varchar(120) NOT NULL DEFAULT 'General',
	`tags` json,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
	`isFeatured` boolean NOT NULL DEFAULT false,
	`publishedAt` timestamp,
	`publishedById` int,
	`createdById` int NOT NULL,
	`updatedById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_base_articles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('article','webinar','resource') NOT NULL,
	`entityId` int NOT NULL,
	`action` varchar(100) NOT NULL,
	`summary` text NOT NULL,
	`metadata` json,
	`actorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `library_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_content_activity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`contentType` enum('article','webinar') NOT NULL,
	`contentId` int NOT NULL,
	`firstViewedAt` timestamp NOT NULL DEFAULT (now()),
	`lastViewedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `library_content_activity_id` PRIMARY KEY(`id`),
	CONSTRAINT `library_activity_user_content_unique` UNIQUE(`userId`,`contentType`,`contentId`)
);
--> statement-breakpoint
CREATE TABLE `library_resources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contentType` enum('article','webinar') NOT NULL,
	`contentId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(600) NOT NULL,
	`mimeType` varchar(180),
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `library_resources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webinar_library_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`descriptionHtml` longtext,
	`category` varchar(120) NOT NULL DEFAULT 'Business development',
	`tags` json,
	`videoUrl` varchar(1200),
	`privateTranscript` longtext,
	`durationMinutes` int,
	`recordedAt` timestamp,
	`linkedEventId` int,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
	`isFeatured` boolean NOT NULL DEFAULT false,
	`publishedAt` timestamp,
	`publishedById` int,
	`createdById` int NOT NULL,
	`updatedById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `webinar_library_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `knowledge_base_articles_status_published_idx` ON `knowledge_base_articles` (`status`,`publishedAt`);--> statement-breakpoint
CREATE INDEX `knowledge_base_articles_category_idx` ON `knowledge_base_articles` (`category`);--> statement-breakpoint
CREATE INDEX `library_audit_entity_idx` ON `library_audit_log` (`entityType`,`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `library_activity_content_completed_idx` ON `library_content_activity` (`contentType`,`contentId`,`completedAt`);--> statement-breakpoint
CREATE INDEX `library_activity_user_completed_idx` ON `library_content_activity` (`userId`,`completedAt`);--> statement-breakpoint
CREATE INDEX `library_resources_content_idx` ON `library_resources` (`contentType`,`contentId`);--> statement-breakpoint
CREATE INDEX `webinar_library_items_status_published_idx` ON `webinar_library_items` (`status`,`publishedAt`);--> statement-breakpoint
CREATE INDEX `webinar_library_items_category_idx` ON `webinar_library_items` (`category`);--> statement-breakpoint
CREATE INDEX `webinar_library_items_event_idx` ON `webinar_library_items` (`linkedEventId`);