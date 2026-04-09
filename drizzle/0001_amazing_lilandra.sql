CREATE TABLE `amendments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`agentId` int NOT NULL,
	`details` text NOT NULL,
	`status` enum('pending','actioned') NOT NULL DEFAULT 'pending',
	`actionedAt` timestamp,
	`actionedById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `amendments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`departureDate` timestamp NOT NULL,
	`topdogRef` varchar(100),
	`reimbursementsRequired` boolean NOT NULL DEFAULT false,
	`reimbursementDocUrl` text,
	`reimbursementDocUploadedAt` timestamp,
	`reimbursementDocLateUpload` boolean NOT NULL DEFAULT false,
	`expectedCommission` decimal(10,2),
	`ptsRef` varchar(100),
	`finalSupplierPaymentDate` timestamp,
	`finalSupplierPaymentNotified` boolean NOT NULL DEFAULT false,
	`currentStage` varchar(100) NOT NULL DEFAULT 'New Booking',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cancellations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`agentId` int NOT NULL,
	`confirmedAt` timestamp NOT NULL DEFAULT (now()),
	`processedById` int,
	`processedAt` timestamp,
	CONSTRAINT `cancellations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `in_app_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bookingId` int,
	`message` text NOT NULL,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `in_app_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`authorId` int NOT NULL,
	`content` text NOT NULL,
	`isInternal` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int,
	`triggerKey` varchar(100) NOT NULL,
	`sentTo` varchar(320) NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`success` boolean NOT NULL DEFAULT true,
	`errorMessage` text,
	CONSTRAINT `notification_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`triggerKey` varchar(100) NOT NULL,
	`label` varchar(255) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`bodyHtml` text NOT NULL,
	`recipientType` enum('agent','admin','both') NOT NULL DEFAULT 'agent',
	`isActive` boolean NOT NULL DEFAULT true,
	`updatedById` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_templates_triggerKey_unique` UNIQUE(`triggerKey`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`fromStage` varchar(100),
	`toStage` varchar(100) NOT NULL,
	`movedById` int NOT NULL,
	`movedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pipeline_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refund_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refundId` int NOT NULL,
	`supplierName` varchar(255) NOT NULL,
	`amountDue` decimal(10,2) NOT NULL,
	CONSTRAINT `refund_suppliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`agentId` int NOT NULL,
	`refundType` enum('supplier','customer','both') NOT NULL,
	`supplierCount` int NOT NULL,
	`amountToClient` decimal(10,2),
	`refundReason` text NOT NULL,
	`clientBankName` text,
	`clientSortCode` text,
	`clientAccountNumber` text,
	`stepsTaken` text NOT NULL,
	`status` enum('pending','processing','completed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('super_admin','admin','agent') NOT NULL DEFAULT 'agent';--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `tempPassword` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `mustChangePassword` boolean DEFAULT false NOT NULL;