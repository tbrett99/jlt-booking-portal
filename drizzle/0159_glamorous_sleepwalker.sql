CREATE TABLE `gc_mandate_replacements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`previousMandateId` varchar(100),
	`replacementMandateId` varchar(100),
	`billingRequestId` varchar(100),
	`billingRequestFlowId` varchar(100),
	`initiationMethod` enum('hosted_flow','manual_link') NOT NULL,
	`status` enum('pending','submitted','active','cancelled','failed','expired','linked') NOT NULL DEFAULT 'pending',
	`preferredPaymentDay` int,
	`initiatedById` int NOT NULL,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gc_mandate_replacements_id` PRIMARY KEY(`id`)
);
