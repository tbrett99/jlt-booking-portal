CREATE TABLE `amendment_line_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`amendmentId` int NOT NULL,
	`type` enum('add_supplier','remove_supplier','change_cost','other') NOT NULL,
	`supplierName` varchar(255),
	`cost` decimal(10,2),
	`oldCost` decimal(10,2),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `amendment_line_items_id` PRIMARY KEY(`id`)
);
