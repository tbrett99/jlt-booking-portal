ALTER TABLE `agent_crm_profiles` ADD `paymentExempt` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `paymentExemptReason` varchar(255);