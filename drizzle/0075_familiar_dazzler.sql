ALTER TABLE `commission_claims` MODIFY COLUMN `status` enum('pending','processing','awaiting_payment','paid','top_up_required') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `topUpAmountPence` int;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `topUpRequestedAt` timestamp;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `topUpRequestedById` int;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `topUpNotifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `topUpResolvedAt` timestamp;