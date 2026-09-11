ALTER TABLE `community_digests` ADD `digestType` enum('weekly','monthly') DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE `community_digests` ADD `periodEnd` timestamp;