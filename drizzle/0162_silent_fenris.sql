CREATE TABLE `academy_email_alert_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertId` int NOT NULL,
	`enrollmentId` int NOT NULL,
	`moduleId` int,
	`eventKey` varchar(180) NOT NULL,
	`recipientEmail` varchar(320) NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `academy_email_alert_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `academy_email_alert_delivery_unique` UNIQUE(`alertId`,`enrollmentId`,`eventKey`)
);
--> statement-breakpoint
CREATE TABLE `academy_email_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`courseId` int NOT NULL,
	`moduleId` int,
	`eventType` enum('week_released','module_started','module_completed','action_submitted_for_review','action_overdue','course_completed','written_assessment_ready','three_attempt_lock') NOT NULL,
	`recipientType` enum('support','custom') NOT NULL DEFAULT 'support',
	`recipientEmail` varchar(320),
	`recipientName` varchar(255),
	`subjectTemplate` varchar(500) NOT NULL,
	`bodyHtmlTemplate` longtext NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdById` int NOT NULL,
	`updatedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_email_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `academy_action_plans` ADD `courseId` int;--> statement-breakpoint
ALTER TABLE `academy_action_plans` ADD `courseWeek` int;--> statement-breakpoint
ALTER TABLE `academy_courses` ADD `isAcceleratorJourney` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `academy_enrollments` ADD `journeyStartedAt` timestamp;--> statement-breakpoint
ALTER TABLE `academy_modules` ADD `releaseWeek` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `academy_email_alert_deliveries_enrollment_idx` ON `academy_email_alert_deliveries` (`enrollmentId`,`sentAt`);--> statement-breakpoint
CREATE INDEX `academy_email_alerts_course_event_active_idx` ON `academy_email_alerts` (`courseId`,`eventType`,`isActive`);--> statement-breakpoint
CREATE INDEX `academy_email_alerts_module_event_active_idx` ON `academy_email_alerts` (`moduleId`,`eventType`,`isActive`);--> statement-breakpoint
CREATE INDEX `academy_action_plans_course_week_idx` ON `academy_action_plans` (`courseId`,`courseWeek`,`status`);--> statement-breakpoint
CREATE INDEX `academy_courses_accelerator_journey_idx` ON `academy_courses` (`status`,`isAcceleratorJourney`);--> statement-breakpoint
CREATE INDEX `academy_enrollments_journey_schedule_idx` ON `academy_enrollments` (`courseId`,`status`,`journeyStartedAt`);