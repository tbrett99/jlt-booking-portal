ALTER TABLE `join_sessions` ADD `signingUserAgent` text;--> statement-breakpoint
ALTER TABLE `join_sessions` ADD `consentConfirmed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `join_sessions` ADD `contractTextSnapshot` longtext;--> statement-breakpoint
ALTER TABLE `join_sessions` ADD `contractHash` varchar(128);--> statement-breakpoint
ALTER TABLE `prospect_contracts` ADD `signingIp` varchar(64);--> statement-breakpoint
ALTER TABLE `prospect_contracts` ADD `signingUserAgent` text;--> statement-breakpoint
ALTER TABLE `prospect_contracts` ADD `consentConfirmed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `prospect_contracts` ADD `contractTextSnapshot` longtext;--> statement-breakpoint
ALTER TABLE `prospect_contracts` ADD `contractHash` varchar(128);