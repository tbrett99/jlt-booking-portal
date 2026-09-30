ALTER TABLE `admin_tasks` ADD CONSTRAINT `admin_tasks_source_note_assignee_unique` UNIQUE(`sourceNoteId`,`assigneeId`);--> statement-breakpoint
CREATE INDEX `admin_tasks_assignee_status_due_idx` ON `admin_tasks` (`assigneeId`,`status`,`dueDate`);--> statement-breakpoint
CREATE INDEX `admin_tasks_created_from_status_idx` ON `admin_tasks` (`createdFrom`,`status`);