CREATE TABLE `recruitment_emails_sent` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`stage` varchar(100) NOT NULL,
	`emailKey` varchar(100) NOT NULL,
	`subject` varchar(500),
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recruitment_emails_sent_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recruitment_prospects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`email` varchar(255) NOT NULL,
	`phone` varchar(50),
	`pipelineStage` varchar(50) NOT NULL DEFAULT 'new_enquiry',
	`applicationData` json,
	`applicationSubmittedAt` timestamp,
	`calComEventId` varchar(255),
	`discoveryCallAt` timestamp,
	`reviewedById` int,
	`reviewedAt` timestamp,
	`declineReason` text,
	`adminNotes` text,
	`source` varchar(100) DEFAULT 'website',
	`tierInterest` varchar(50),
	`howHeard` varchar(255),
	`prospectusEmailSentAt` timestamp,
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recruitment_prospects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recruitment_stage_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`fromStage` varchar(100),
	`toStage` varchar(100) NOT NULL,
	`changedById` int,
	`changedByName` varchar(200),
	`note` text,
	`changedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recruitment_stage_history_id` PRIMARY KEY(`id`)
);
