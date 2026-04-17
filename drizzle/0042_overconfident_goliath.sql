CREATE TABLE `export_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ranAt` timestamp NOT NULL DEFAULT (now()),
	`success` boolean NOT NULL,
	`rowCount` int,
	`errorMessage` text,
	`triggeredBy` varchar(50) DEFAULT 'cron',
	CONSTRAINT `export_runs_id` PRIMARY KEY(`id`)
);
