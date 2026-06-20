CREATE TABLE `supplier_login_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`supplierId` int NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`fulfilledAt` timestamp,
	CONSTRAINT `supplier_login_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `suppliers` ADD `requiresLoginRequest` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `loginRequestNotes` text;