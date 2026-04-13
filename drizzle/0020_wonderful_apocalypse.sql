CREATE TABLE `reimbursement_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`agentId` int NOT NULL,
	`supplierName` varchar(255) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`status` enum('pending','scheduled','paid') NOT NULL DEFAULT 'pending',
	`isLate` boolean NOT NULL DEFAULT false,
	`scheduledAt` timestamp,
	`paidAt` timestamp,
	`paidById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reimbursement_items_id` PRIMARY KEY(`id`)
);
