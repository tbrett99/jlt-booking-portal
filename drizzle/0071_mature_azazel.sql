CREATE TABLE `reimbursement_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reimbursementItemId` int NOT NULL,
	`bookingId` int NOT NULL,
	`action` varchar(100) NOT NULL,
	`oldStatus` varchar(50),
	`newStatus` varchar(50),
	`actedById` int NOT NULL,
	`actedAt` timestamp NOT NULL DEFAULT (now()),
	`note` text,
	CONSTRAINT `reimbursement_audit_logs_id` PRIMARY KEY(`id`)
);
