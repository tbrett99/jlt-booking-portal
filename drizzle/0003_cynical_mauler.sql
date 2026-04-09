CREATE TABLE `commission_claims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`agentId` int NOT NULL,
	`claimedAt` timestamp NOT NULL DEFAULT (now()),
	`status` enum('claimed_not_paid','paid') NOT NULL DEFAULT 'claimed_not_paid',
	`paidAt` timestamp,
	`paidById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commission_claims_id` PRIMARY KEY(`id`)
);
