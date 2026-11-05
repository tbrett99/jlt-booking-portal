CREATE TABLE `staff_academy_uploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`courseId` int NOT NULL,
	`objectKey` varchar(600) NOT NULL,
	`kind` enum('attachment','document_template','image') NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_academy_uploads_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_upload_key_uq` UNIQUE(`objectKey`)
);
--> statement-breakpoint
CREATE TABLE `staff_access_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorId` int NOT NULL,
	`targetUserId` int NOT NULL,
	`action` varchar(100) NOT NULL,
	`metadata` json NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_access_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_instructor_courses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assignmentId` int NOT NULL,
	`courseId` int NOT NULL,
	CONSTRAINT `staff_instructor_courses_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_assignment_course_uq` UNIQUE(`assignmentId`,`courseId`)
);
--> statement-breakpoint
CREATE TABLE `staff_role_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`staffRole` enum('instructor','agent_engagement') NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`grantedById` int NOT NULL,
	`grantedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`revokedById` int,
	`revokedAt` timestamp(3),
	CONSTRAINT `staff_role_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_user_role_uq` UNIQUE(`userId`,`staffRole`)
);
--> statement-breakpoint
CREATE INDEX `staff_upload_course_idx` ON `staff_academy_uploads` (`courseId`,`userId`);--> statement-breakpoint
CREATE INDEX `staff_audit_actor_idx` ON `staff_access_audit` (`actorId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `staff_audit_target_idx` ON `staff_access_audit` (`targetUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `staff_course_idx` ON `staff_instructor_courses` (`courseId`);