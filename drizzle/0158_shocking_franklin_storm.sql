ALTER TABLE `academy_lesson_progress` ADD `lessonActiveSeconds` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `academy_lesson_progress` ADD `assessmentActiveSeconds` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `academy_lesson_progress` ADD `lastActivityAt` timestamp;