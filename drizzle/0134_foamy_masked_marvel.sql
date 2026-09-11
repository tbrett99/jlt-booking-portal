ALTER TABLE `public_agent_profiles` ADD `publishedSnapshot` json;--> statement-breakpoint
ALTER TABLE `public_agent_profiles` ADD `publishedTagIds` json;--> statement-breakpoint
ALTER TABLE `public_agent_profiles` ADD `publishedEnquiryDeliveryEmail` varchar(320);