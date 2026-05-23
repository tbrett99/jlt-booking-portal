CREATE TABLE `community_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`authorId` int NOT NULL,
	`authorName` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`isDeleted` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `community_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_confirmation_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`userId` int NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `community_confirmation_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_confirmations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`userId` int NOT NULL,
	`confirmedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `community_confirmations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_digests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`weekStarting` timestamp NOT NULL,
	`status` enum('draft','sent') NOT NULL DEFAULT 'draft',
	`introText` text,
	`includedPostIds` json,
	`includeBookingHighlights` boolean NOT NULL DEFAULT true,
	`bookingHighlightsOverride` json,
	`statsSnapshot` json,
	`sentAt` timestamp,
	`sentById` int,
	`recipientCount` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `community_digests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_post_views` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`userId` int NOT NULL,
	`viewedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `community_post_views_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`authorId` int NOT NULL,
	`authorName` varchar(255) NOT NULL,
	`category` enum('business_update','supplier_news_deals','news_announcements','agent_win','jlt_stay_story','events','training_webinars','mindset','first_class_lounge') NOT NULL,
	`supplierSubCategory` varchar(100),
	`supplierPostType` enum('news','deal'),
	`title` varchar(500) NOT NULL,
	`bodyHtml` longtext NOT NULL,
	`loomUrl` varchar(500),
	`imageUrls` json,
	`attachmentUrls` json,
	`isPinned` boolean NOT NULL DEFAULT false,
	`isHidden` boolean NOT NULL DEFAULT false,
	`isDraft` boolean NOT NULL DEFAULT false,
	`requiresConfirmation` boolean NOT NULL DEFAULT false,
	`expiresAt` timestamp,
	`viewCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `community_posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_reactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`userId` int NOT NULL,
	`emoji` enum('thumbs_up','heart','celebrate','fire','plane') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `community_reactions_id` PRIMARY KEY(`id`)
);
