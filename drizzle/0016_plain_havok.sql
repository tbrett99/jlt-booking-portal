CREATE TABLE `admin_notification_prefs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`triggerKey` varchar(100) NOT NULL,
	`emailEnabled` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_notification_prefs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_task_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`authorId` int NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_task_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(500) NOT NULL,
	`description` text,
	`status` enum('open','in_progress','done') NOT NULL DEFAULT 'open',
	`priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
	`assigneeId` int,
	`createdById` int NOT NULL,
	`dueDate` timestamp,
	`linkedType` enum('booking','amendment','refund','cancellation','none') NOT NULL DEFAULT 'none',
	`linkedId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_tasks_id` PRIMARY KEY(`id`)
);
