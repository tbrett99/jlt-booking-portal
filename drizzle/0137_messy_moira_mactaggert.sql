ALTER TABLE `public_enquiries` ADD `showcaseId` int;--> statement-breakpoint
CREATE INDEX `public_enquiries_showcase_idx` ON `public_enquiries` (`showcaseId`,`createdAt`);