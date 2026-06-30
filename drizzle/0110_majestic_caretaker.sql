CREATE TABLE `roadmap_item_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`authorId` int NOT NULL,
	`note` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roadmap_item_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roadmap_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`category` enum('Bookings','Payments','CRM','Reports','Commissions','Community','Mobile','Admin','Other') NOT NULL DEFAULT 'Other',
	`status` enum('under_consideration','planned','in_progress','released') NOT NULL DEFAULT 'planned',
	`timeframe` varchar(100),
	`progressPct` int NOT NULL DEFAULT 0,
	`internalNotes` text,
	`effort` enum('small','medium','large','xl'),
	`priorityScore` int NOT NULL DEFAULT 0,
	`fromSuggestionId` int,
	`isVisible` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`releasedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `roadmap_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roadmap_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`status` enum('open','under_review','planned','declined') NOT NULL DEFAULT 'open',
	`convertedToItemId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roadmap_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roadmap_votes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`suggestionId` int NOT NULL,
	`value` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roadmap_votes_id` PRIMARY KEY(`id`)
);
