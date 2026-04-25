CREATE TABLE `agent_crm_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentUserId` int NOT NULL,
	`authorId` int NOT NULL,
	`authorName` varchar(128),
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_crm_notes_id` PRIMARY KEY(`id`)
);
