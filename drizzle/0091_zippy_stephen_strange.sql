ALTER TABLE `suppliers` MODIFY COLUMN `agencyId` text;--> statement-breakpoint
ALTER TABLE `suppliers` MODIFY COLUMN `phone` varchar(500);--> statement-breakpoint
ALTER TABLE `suppliers` ADD `usp` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `priceTier` varchar(50);--> statement-breakpoint
ALTER TABLE `suppliers` ADD `notSuitableFor` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `preferredContact` varchar(100);--> statement-breakpoint
ALTER TABLE `suppliers` ADD `aiSummary` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `aiEnrichedAt` timestamp;