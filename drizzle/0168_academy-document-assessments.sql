ALTER TABLE `academy_assessment_attempts` ADD `assessmentTemplateKey` varchar(600);--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `assessmentTemplateName` varchar(255);--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `assessmentTemplateMimeType` varchar(120);--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `submissionFileKey` varchar(600);--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `submissionFileName` varchar(255);--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `submissionMimeType` varchar(120);--> statement-breakpoint
ALTER TABLE `academy_assessment_attempts` ADD `submissionFileSize` int;--> statement-breakpoint
ALTER TABLE `academy_lessons` ADD `assessmentMode` enum('quiz','document_upload') DEFAULT 'quiz' NOT NULL;--> statement-breakpoint
ALTER TABLE `academy_lessons` ADD `assessmentTemplateKey` varchar(600);--> statement-breakpoint
ALTER TABLE `academy_lessons` ADD `assessmentTemplateName` varchar(255);--> statement-breakpoint
ALTER TABLE `academy_lessons` ADD `assessmentTemplateMimeType` varchar(120);--> statement-breakpoint
ALTER TABLE `academy_lessons` ADD `assessmentTemplateSize` int;