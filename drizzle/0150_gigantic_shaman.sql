CREATE TABLE `academy_assessment_responses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`attemptId` int NOT NULL,
	`questionId` int NOT NULL,
	`selectedIndex` int,
	`responseText` longtext,
	`score` int,
	`feedback` text,
	`gradedById` int,
	`gradedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_assessment_responses_id` PRIMARY KEY(`id`),
	CONSTRAINT `academy_attempt_response_question_unique` UNIQUE(`attemptId`,`questionId`)
);
--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` MODIFY COLUMN `score` int;--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` MODIFY COLUMN `passed` boolean;--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `status` enum('auto_graded','awaiting_marking','feedback_pending','feedback_acknowledged') DEFAULT 'auto_graded' NOT NULL;--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `graderFeedback` text;--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `gradedById` int;--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `gradedAt` timestamp;--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `feedbackAcknowledgedAt` timestamp;--> statement-breakpoint
ALTER TABLE `academy_questions` ADD `questionType` enum('multiple_choice','free_text') DEFAULT 'multiple_choice' NOT NULL;--> statement-breakpoint
ALTER TABLE `academy_questions` ADD `maxWords` int DEFAULT 250 NOT NULL;--> statement-breakpoint
CREATE INDEX `academy_attempt_responses_attempt_idx` ON `academy_assessment_responses` (`attemptId`);--> statement-breakpoint
CREATE INDEX `academy_attempts_status_taken_idx` ON `academy_assessment_attempts` (`status`,`takenAt`);