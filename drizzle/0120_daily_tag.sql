CREATE TABLE `digest_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`digestType` varchar(64) NOT NULL DEFAULT 'weekly',
	`periodFrom` timestamp NOT NULL,
	`periodTo` timestamp NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `digest_runs_id` PRIMARY KEY(`id`)
);
