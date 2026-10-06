CREATE TABLE `academy_assessment_question_resets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enrollmentId` int NOT NULL,
	`lessonId` int NOT NULL,
	`questionId` int NOT NULL,
	`resetById` int NOT NULL,
	`reason` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `academy_assessment_question_resets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `academy_question_resets_enrollment_question_idx` ON `academy_assessment_question_resets` (`enrollmentId`,`questionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `academy_question_resets_lesson_created_idx` ON `academy_assessment_question_resets` (`lessonId`,`createdAt`);