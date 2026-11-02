ALTER TABLE `membership_payment_control` MODIFY COLUMN `activatedAt` timestamp(3);--> statement-breakpoint
ALTER TABLE `membership_payment_inbox` MODIFY COLUMN `occurredAt` timestamp(3) NOT NULL;--> statement-breakpoint
ALTER TABLE `membership_payment_settlements` MODIFY COLUMN `settledAt` timestamp(3) NOT NULL;