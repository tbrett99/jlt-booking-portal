CREATE TABLE `reimbursement_docs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`uploadedById` int NOT NULL,
	`fileUrl` text NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(100),
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reimbursement_docs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `amendments` ADD `isReimbursementDoc` boolean DEFAULT false NOT NULL;