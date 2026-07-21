ALTER TABLE `suppliers` ADD `isPreferredPartner` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `preferredPartnerNote` text;