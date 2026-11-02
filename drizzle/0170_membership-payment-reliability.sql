CREATE TABLE `membership_payment_accounts` (
	`userId` int NOT NULL,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`outstandingPence` int,
	`outstandingCount` int NOT NULL DEFAULT 0,
	`runKey` varchar(100),
	`lastFailedAt` timestamp,
	`lastSyncedAt` timestamp,
	`lastError` text,
	`historyReviewRequired` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `membership_payment_accounts_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `membership_payment_control` (
	`id` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`activatedAt` timestamp,
	`feeAmountPence` int NOT NULL DEFAULT 2500,
	`feePolicyApproved` boolean NOT NULL DEFAULT false,
	`feeCollectionMode` varchar(30) NOT NULL DEFAULT 'staff_approval',
	`lastEventSyncAt` timestamp,
	`lastSuccessAt` timestamp,
	`syncLockToken` varchar(64),
	`syncLockedUntil` timestamp,
	`schedule_cron_task_uid` varchar(65),
	`lastError` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `membership_payment_control_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `membership_payment_fees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`runKey` varchar(100) NOT NULL,
	`triggerEventId` varchar(100) NOT NULL,
	`amountPence` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'GBP',
	`status` varchar(30) NOT NULL DEFAULT 'review',
	`paymentId` varchar(100),
	`approvedById` int,
	`settledById` int,
	`notes` text,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `membership_payment_fees_id` PRIMARY KEY(`id`),
	CONSTRAINT `membership_payment_fees_runKey_unique` UNIQUE(`runKey`)
);
--> statement-breakpoint
CREATE TABLE `membership_payment_inbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(100) NOT NULL,
	`userId` int,
	`paymentId` varchar(100),
	`mandateId` varchar(100),
	`subscriptionId` varchar(100),
	`action` varchar(60) NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`amountPence` int,
	`currency` varchar(3),
	`willAttemptRetry` boolean,
	`reason` text,
	`status` varchar(30) NOT NULL DEFAULT 'pending',
	`source` varchar(30) NOT NULL,
	`rawPayload` mediumtext NOT NULL,
	`lastError` text,
	`processingAttempts` int NOT NULL DEFAULT 0,
	`nextProcessingAt` timestamp,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `membership_payment_inbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `membership_payment_inbox_eventId_unique` UNIQUE(`eventId`)
);
--> statement-breakpoint
CREATE TABLE `membership_payment_obligations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`paymentId` varchar(100) NOT NULL,
	`amountPence` int,
	`currency` varchar(3),
	`status` varchar(30) NOT NULL,
	`lastEventAt` timestamp NOT NULL,
	`lastFailureAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `membership_payment_obligations_id` PRIMARY KEY(`id`),
	CONSTRAINT `membership_payment_obligations_paymentId_unique` UNIQUE(`paymentId`)
);
--> statement-breakpoint
CREATE TABLE `membership_payment_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dedupeKey` varchar(180) NOT NULL,
	`userId` int NOT NULL,
	`eventId` varchar(100),
	`kind` varchar(30) NOT NULL,
	`status` varchar(30) NOT NULL DEFAULT 'pending',
	`payload` mediumtext NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`lockedUntil` timestamp,
	`lockToken` varchar(64),
	`firstAttemptAt` timestamp,
	`lastError` text,
	`providerMessageId` varchar(100),
	`recipientEmail` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `membership_payment_outbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `membership_payment_outbox_dedupeKey_unique` UNIQUE(`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `membership_payment_settlements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`paymentId` varchar(100) NOT NULL,
	`settledAt` timestamp NOT NULL,
	`recordedById` int NOT NULL,
	`reference` varchar(255) NOT NULL,
	`notes` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `membership_payment_settlements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `membership_control_cron_uid_idx` ON `membership_payment_control` (`schedule_cron_task_uid`);--> statement-breakpoint
CREATE INDEX `membership_fee_user_status_idx` ON `membership_payment_fees` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `membership_inbox_pending_idx` ON `membership_payment_inbox` (`status`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `membership_inbox_user_idx` ON `membership_payment_inbox` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `membership_obligation_user_status_idx` ON `membership_payment_obligations` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `membership_outbox_work_idx` ON `membership_payment_outbox` (`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `membership_outbox_user_idx` ON `membership_payment_outbox` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `membership_settlement_user_idx` ON `membership_payment_settlements` (`userId`,`settledAt`);