CREATE TABLE `momentum_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`ruleKey` varchar(80) NOT NULL,
	`sourceType` varchar(80) NOT NULL,
	`sourceId` int NOT NULL,
	`sourceLabel` varchar(500) NOT NULL,
	`points` int NOT NULL,
	`status` enum('awarded','reversed') NOT NULL DEFAULT 'awarded',
	`awardedAt` timestamp NOT NULL DEFAULT (now()),
	`reversedAt` timestamp,
	`reversedById` int,
	`reversalReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `momentum_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `momentum_ledger_agent_rule_source_unique` UNIQUE(`agentId`,`ruleKey`,`sourceType`,`sourceId`)
);
--> statement-breakpoint
CREATE TABLE `momentum_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ruleKey` varchar(80) NOT NULL,
	`label` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`area` varchar(80) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`points` int NOT NULL DEFAULT 0,
	`weeklyCap` int NOT NULL DEFAULT 0,
	`minimumTextLength` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `momentum_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `momentum_rules_ruleKey_unique` UNIQUE(`ruleKey`)
);
--> statement-breakpoint
ALTER TABLE `academy_action_plans` ADD `momentumAwardMode` enum('off','self_declared_completion','reviewed_completion') DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `academy_action_plans` ADD `momentumPoints` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `momentum_ledger_agent_status_awarded_idx` ON `momentum_ledger` (`agentId`,`status`,`awardedAt`);--> statement-breakpoint
CREATE INDEX `momentum_ledger_source_idx` ON `momentum_ledger` (`sourceType`,`sourceId`); 
--> statement-breakpoint
INSERT INTO `momentum_rules` (`ruleKey`, `label`, `description`, `area`, `enabled`, `points`, `weeklyCap`, `minimumTextLength`) VALUES
('community_reaction', 'React to a Community post', 'One point when an active agent reacts to another person’s Community post. One award per post; re-adding a removed reaction does not create another award.', 'Community', true, 1, 10, 0),
('community_comment', 'Write a meaningful Community comment', 'Awarded for a first comment on another person’s post when it meets the minimum length. One award per post and a weekly cap prevent point farming.', 'Community', true, 3, 15, 20),
('community_confirmation', 'Acknowledge a critical JLT update', 'Awarded once when an active agent confirms an important business update.', 'Community', true, 2, 0, 0),
('community_agent_win', 'Share an Agent Win', 'Awarded once when an active agent shares an Agent Win. Points reverse automatically if the post is hidden or removed.', 'Community', true, 5, 5, 0),
('accountability_action', 'Complete a selected Accountability Task', 'Master switch for Momentum rewards on Accountability Tasks. Each task separately chooses its point amount and whether self-declaration or staff review triggers the award.', 'Accountability Tasks', true, 10, 0, 0),
('knowledge_base_checkpoint', 'Complete a Knowledge Base checkpoint', 'Reserved for automatically marked Knowledge Base checks. It remains off until the Knowledge Base is live.', 'Knowledge Base', false, 2, 0, 0),
('webinar_checkpoint', 'Pass a webinar quick check', 'Reserved for automatically marked checks after a recorded webinar. It remains off until webinar content and checkpoints are live.', 'Webinars', false, 5, 0, 0),
('verified_event_attendance', 'Attend a verified live event', 'Reserved for a future verified attendance workflow. It is not awarded for an RSVP alone.', 'Events', false, 10, 0, 0);
