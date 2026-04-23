CREATE TABLE `admin_onboarding_checklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`trainingHubLogin` boolean NOT NULL DEFAULT false,
	`jltEmailSetup` boolean NOT NULL DEFAULT false,
	`idDocsReviewed` boolean NOT NULL DEFAULT false,
	`contractReviewed` boolean NOT NULL DEFAULT false,
	`welcomeEmailSent` boolean NOT NULL DEFAULT false,
	`portalAccessApproved` boolean NOT NULL DEFAULT false,
	`updatedById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_onboarding_checklist_id` PRIMARY KEY(`id`)
);
