ALTER TABLE `agent_crm_profiles` ADD `agentStatus` varchar(50) DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `businessName` varchar(255);--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `retailerCode` varchar(50);--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `introducedBy` varchar(255);--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `dateJoined` varchar(30);--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `monthlySub` varchar(50);--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `internalNotes` text;