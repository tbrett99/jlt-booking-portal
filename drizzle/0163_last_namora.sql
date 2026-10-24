ALTER TABLE `academy_action_assignments` ADD `dueAt` timestamp;--> statement-breakpoint
CREATE INDEX `academy_action_assignments_due_status_idx` ON `academy_action_assignments` (`dueAt`,`status`);