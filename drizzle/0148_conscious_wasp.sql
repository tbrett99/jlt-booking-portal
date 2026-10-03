CREATE TABLE `academy_access` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`grantedById` int NOT NULL,
	`grantedAt` timestamp NOT NULL DEFAULT (now()),
	`revokedById` int,
	`revokedAt` timestamp,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_access_id` PRIMARY KEY(`id`),
	CONSTRAINT `academy_access_agent_unique` UNIQUE(`agentId`)
);
--> statement-breakpoint
CREATE TABLE `academy_assessment_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enrollmentId` int NOT NULL,
	`lessonId` int NOT NULL,
	`score` int NOT NULL,
	`passed` boolean NOT NULL,
	`answers` json NOT NULL,
	`takenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `academy_assessment_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `academy_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int,
	`courseId` int,
	`enrollmentId` int,
	`actorId` int,
	`action` varchar(100) NOT NULL,
	`summary` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `academy_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `academy_courses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`coverImageUrl` text,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
	`isCoreAcademy` boolean NOT NULL DEFAULT false,
	`estimatedMinutes` int NOT NULL DEFAULT 0,
	`createdById` int NOT NULL,
	`updatedById` int NOT NULL,
	`publishedAt` timestamp,
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_courses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `academy_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`courseId` int NOT NULL,
	`status` enum('assigned','in_progress','completed','waived') NOT NULL DEFAULT 'assigned',
	`enrolledById` int NOT NULL,
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	`dueDate` timestamp,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`lastReminderAt` timestamp,
	`completionOutcomeAppliedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `academy_enrollments_agent_course_unique` UNIQUE(`agentId`,`courseId`)
);
--> statement-breakpoint
CREATE TABLE `academy_lesson_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enrollmentId` int NOT NULL,
	`lessonId` int NOT NULL,
	`startedAt` timestamp,
	`lastViewedAt` timestamp,
	`acknowledgedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_lesson_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `academy_progress_enrollment_lesson_unique` UNIQUE(`enrollmentId`,`lessonId`)
);
--> statement-breakpoint
CREATE TABLE `academy_lessons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`moduleId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`contentHtml` longtext,
	`videoUrl` varchar(1200),
	`attachmentUrl` text,
	`attachmentKey` varchar(600),
	`attachmentName` varchar(255),
	`estimatedMinutes` int NOT NULL DEFAULT 5,
	`isRequired` boolean NOT NULL DEFAULT true,
	`requiresAcknowledgement` boolean NOT NULL DEFAULT false,
	`requiresAssessment` boolean NOT NULL DEFAULT false,
	`assessmentPassMark` int NOT NULL DEFAULT 80,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_lessons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `academy_modules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`courseId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_modules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `academy_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lessonId` int NOT NULL,
	`prompt` text NOT NULL,
	`answerOptions` json NOT NULL,
	`correctAnswerIndex` int NOT NULL,
	`explanation` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admin_onboarding_checklist` ADD `academyAccessApproved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `academyAcceleratorStartedAt` timestamp;--> statement-breakpoint
ALTER TABLE `agent_crm_profiles` ADD `academyAccreditedAt` timestamp;--> statement-breakpoint
CREATE INDEX `academy_access_status_idx` ON `academy_access` (`status`);--> statement-breakpoint
CREATE INDEX `academy_attempts_enrollment_lesson_idx` ON `academy_assessment_attempts` (`enrollmentId`,`lessonId`);--> statement-breakpoint
CREATE INDEX `academy_audit_agent_created_idx` ON `academy_audit_log` (`agentId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `academy_audit_course_created_idx` ON `academy_audit_log` (`courseId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `academy_courses_status_core_idx` ON `academy_courses` (`status`,`isCoreAcademy`);--> statement-breakpoint
CREATE INDEX `academy_enrollments_agent_status_idx` ON `academy_enrollments` (`agentId`,`status`);--> statement-breakpoint
CREATE INDEX `academy_enrollments_course_status_due_idx` ON `academy_enrollments` (`courseId`,`status`,`dueDate`);--> statement-breakpoint
CREATE INDEX `academy_progress_lesson_idx` ON `academy_lesson_progress` (`lessonId`);--> statement-breakpoint
CREATE INDEX `academy_lessons_module_sort_idx` ON `academy_lessons` (`moduleId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `academy_modules_course_sort_idx` ON `academy_modules` (`courseId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `academy_questions_lesson_sort_idx` ON `academy_questions` (`lessonId`,`sortOrder`);