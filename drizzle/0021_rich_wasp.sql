CREATE TABLE `reimbursement_item_docs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reimbursementItemId` int NOT NULL,
	`bookingId` int NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reimbursement_item_docs_id` PRIMARY KEY(`id`)
);
