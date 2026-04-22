CREATE TABLE `gc_mandates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mandateId` varchar(100),
	`billingRequestId` varchar(100),
	`billingRequestFlowId` varchar(100),
	`status` enum('pending','active','cancelled','failed','expired') NOT NULL DEFAULT 'pending',
	`preferredPaymentDay` int,
	`joiningFeePaidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gc_mandates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gc_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mandateId` varchar(100) NOT NULL,
	`subscriptionId` varchar(100),
	`status` enum('active','paused','cancelled','finished') NOT NULL DEFAULT 'active',
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'GBP',
	`startDate` varchar(10) NOT NULL,
	`dayOfMonth` int,
	`nextChargeDate` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gc_subscriptions_id` PRIMARY KEY(`id`)
);
