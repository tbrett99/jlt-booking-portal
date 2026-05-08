CREATE TABLE `recruitment_workflow_emails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workflowId` int NOT NULL,
	`stepOrder` int NOT NULL,
	`delayHours` int NOT NULL DEFAULT 0,
	`subject` varchar(500) NOT NULL,
	`bodyHtml` longtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recruitment_workflow_emails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recruitment_workflow_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`workflowId` int NOT NULL,
	`currentStep` int NOT NULL DEFAULT 1,
	`nextSendAt` timestamp,
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	`cancelledAt` timestamp,
	CONSTRAINT `recruitment_workflow_enrollments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recruitment_workflows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stage` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recruitment_workflows_id` PRIMARY KEY(`id`),
	CONSTRAINT `recruitment_workflows_stage_unique` UNIQUE(`stage`)
);
