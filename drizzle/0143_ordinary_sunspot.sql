ALTER TABLE `reimbursement_items` MODIFY COLUMN `status` enum('pending','awaiting_agent','scheduled','paid') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `reimbursement_items` ADD `nextFollowUpAt` timestamp;--> statement-breakpoint
ALTER TABLE `reimbursement_items` ADD `lastChasedAt` timestamp;--> statement-breakpoint
ALTER TABLE `reimbursement_items` ADD `lastChasedById` int;--> statement-breakpoint
CREATE INDEX `reimbursement_items_status_followup_idx` ON `reimbursement_items` (`status`,`nextFollowUpAt`);