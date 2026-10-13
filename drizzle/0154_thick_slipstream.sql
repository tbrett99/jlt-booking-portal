CREATE TABLE `academy_action_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`planId` int NOT NULL,
	`agentId` int NOT NULL,
	`status` enum('assigned','submitted','review','completed','needs_revision') NOT NULL DEFAULT 'assigned',
	`completionNote` text,
	`evidenceUrl` text,
	`evidenceFileUrl` text,
	`evidenceFileKey` varchar(600),
	`evidenceFileName` varchar(255),
	`submittedAt` timestamp,
	`reviewedAt` timestamp,
	`reviewedById` int,
	`reviewerFeedback` text,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_action_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `academy_action_assignment_plan_agent_unique` UNIQUE(`planId`,`agentId`)
);
--> statement-breakpoint
CREATE TABLE `academy_action_plan_targets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`planId` int NOT NULL,
	`agentId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `academy_action_plan_targets_id` PRIMARY KEY(`id`),
	CONSTRAINT `academy_action_target_plan_agent_unique` UNIQUE(`planId`,`agentId`)
);
--> statement-breakpoint
CREATE TABLE `academy_action_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`instructions` text NOT NULL,
	`actionType` enum('onboarding','weekly','ad_hoc') NOT NULL,
	`audience` enum('agent_accelerator','selected_agents','all_agents') NOT NULL,
	`assignmentTrigger` enum('immediate','on_accelerator_entry') NOT NULL DEFAULT 'immediate',
	`status` enum('draft','scheduled','published','archived') NOT NULL DEFAULT 'draft',
	`publishAt` timestamp,
	`dueAt` timestamp,
	`requiresNote` boolean NOT NULL DEFAULT true,
	`requiresUrl` boolean NOT NULL DEFAULT false,
	`requiresUpload` boolean NOT NULL DEFAULT false,
	`staffReviewRequired` boolean NOT NULL DEFAULT false,
	`createdById` int NOT NULL,
	`updatedById` int NOT NULL,
	`publishedById` int,
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_action_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_engagement_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`status` enum('active','waiting','monitoring','closed') NOT NULL DEFAULT 'active',
	`riskReason` text NOT NULL,
	`ownerId` int,
	`openedById` int NOT NULL,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`lastContactAt` timestamp,
	`nextFollowUpAt` timestamp,
	`outcome` text,
	`closedAt` timestamp,
	`closedById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_engagement_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_engagement_interactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseId` int NOT NULL,
	`agentId` int NOT NULL,
	`createdById` int NOT NULL,
	`channel` enum('call','email','whatsapp','meeting','other') NOT NULL,
	`summary` text NOT NULL,
	`outcome` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`nextFollowUpAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_engagement_interactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `academy_action_assignments_agent_status_idx` ON `academy_action_assignments` (`agentId`,`status`);--> statement-breakpoint
CREATE INDEX `academy_action_assignments_plan_status_idx` ON `academy_action_assignments` (`planId`,`status`);--> statement-breakpoint
CREATE INDEX `academy_action_target_agent_idx` ON `academy_action_plan_targets` (`agentId`);--> statement-breakpoint
CREATE INDEX `academy_action_plans_status_publish_idx` ON `academy_action_plans` (`status`,`publishAt`);--> statement-breakpoint
CREATE INDEX `academy_action_plans_audience_trigger_idx` ON `academy_action_plans` (`audience`,`assignmentTrigger`);--> statement-breakpoint
CREATE INDEX `agent_engagement_cases_status_followup_idx` ON `agent_engagement_cases` (`status`,`nextFollowUpAt`);--> statement-breakpoint
CREATE INDEX `agent_engagement_cases_agent_opened_idx` ON `agent_engagement_cases` (`agentId`,`openedAt`);--> statement-breakpoint
CREATE INDEX `agent_engagement_interactions_case_occurred_idx` ON `agent_engagement_interactions` (`caseId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `agent_engagement_interactions_agent_occurred_idx` ON `agent_engagement_interactions` (`agentId`,`occurredAt`);