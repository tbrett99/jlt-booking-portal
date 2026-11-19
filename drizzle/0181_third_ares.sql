CREATE TABLE IF NOT EXISTS `staff_handbook_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createToken` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`draftRevisionId` int,
	`publishedRevisionId` int,
	`reviewedRevisionId` int,
	`reviewedById` int,
	`submittedAt` timestamp,
	`archivedAt` timestamp,
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `staff_handbook_articles_id` PRIMARY KEY(`id`),
	CONSTRAINT `sh_article_token_uq` UNIQUE(`createToken`),
	INDEX `sh_article_archive_idx` (`archivedAt`),
	INDEX `sh_article_draft_idx` (`draftRevisionId`),
	INDEX `sh_article_published_idx` (`publishedRevisionId`)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_handbook_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('article','request','resource') NOT NULL,
	`entityId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`actorId` int NOT NULL,
	`summary` varchar(500) NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_handbook_audit_id` PRIMARY KEY(`id`),
	INDEX `sh_audit_entity_idx` (`entityType`,`entityId`,`createdAt`)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_handbook_resources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(180) NOT NULL,
	`byteSize` int NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`fileKey` varchar(600) NOT NULL,
	`removedAt` timestamp,
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_handbook_resources_id` PRIMARY KEY(`id`),
	CONSTRAINT `sh_resource_key_uq` UNIQUE(`fileKey`),
	CONSTRAINT `sh_resource_article_fk` FOREIGN KEY (`articleId`) REFERENCES `staff_handbook_articles`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `sh_resource_article_idx` (`articleId`,`removedAt`)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_handbook_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleId` int NOT NULL,
	`revisionNumber` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`category` varchar(120) NOT NULL,
	`content` json NOT NULL,
	`searchText` longtext NOT NULL,
	`resourceIds` json NOT NULL,
	`contributorIds` json NOT NULL,
	`createdById` int NOT NULL,
	`changeSummary` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_handbook_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sh_revision_number_uq` UNIQUE(`articleId`,`revisionNumber`),
	CONSTRAINT `sh_revision_article_fk` FOREIGN KEY (`articleId`) REFERENCES `staff_handbook_articles`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `sh_revision_category_idx` (`category`)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_knowledge_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createToken` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`category` varchar(120) NOT NULL,
	`kind` enum('missing_process','unclear','outdated','conflicting','recurring_question') NOT NULL,
	`checkedGuidance` text,
	`impact` text,
	`priority` enum('low','normal','high') NOT NULL DEFAULT 'normal',
	`status` enum('new','triaged','assigned','drafting','in_review','resolved','closed') NOT NULL DEFAULT 'new',
	`reporterId` int NOT NULL,
	`assigneeId` int,
	`articleId` int,
	`resolvedRevisionId` int,
	`duplicateOfId` int,
	`closureReason` text,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `staff_knowledge_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `sh_request_token_uq` UNIQUE(`createToken`),
	CONSTRAINT `sh_request_article_fk` FOREIGN KEY (`articleId`) REFERENCES `staff_handbook_articles`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `sh_request_revision_fk` FOREIGN KEY (`resolvedRevisionId`) REFERENCES `staff_handbook_revisions`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `sh_request_queue_idx` (`status`,`priority`,`updatedAt`),
	INDEX `sh_request_assignee_idx` (`assigneeId`,`status`),
	INDEX `sh_request_article_idx` (`articleId`)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_knowledge_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`authorId` int NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_knowledge_comments_id` PRIMARY KEY(`id`),
	CONSTRAINT `sh_comment_request_fk` FOREIGN KEY (`requestId`) REFERENCES `staff_knowledge_requests`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `sh_comment_request_idx` (`requestId`,`createdAt`)
);
