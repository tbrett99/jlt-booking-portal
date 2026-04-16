CREATE TABLE `agent_change_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fieldName` varchar(100) NOT NULL,
	`fieldLabel` varchar(150) NOT NULL,
	`currentValue` text,
	`requestedValue` text NOT NULL,
	`reason` text,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`adminNote` text,
	`reviewedById` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_change_requests_id` PRIMARY KEY(`id`)
);
