ALTER TABLE `gc_subscriptions` MODIFY COLUMN `userId` int;--> statement-breakpoint
ALTER TABLE `agent_supplier_logins` ADD `welcomeEmailSentAt` timestamp;