CREATE TABLE `agent_record_merges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceUserId` int NOT NULL,
	`primaryUserId` int NOT NULL,
	`sourceName` text,
	`sourceEmail` varchar(320),
	`sourceJltId` varchar(20),
	`actorId` int NOT NULL,
	`actorName` text,
	`reason` text NOT NULL,
	`previewDigest` varchar(64) NOT NULL,
	`manifestJson` longtext NOT NULL,
	`mergedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `agent_record_merges_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_record_merges_sourceUserId_unique` UNIQUE(`sourceUserId`)
);
--> statement-breakpoint
CREATE INDEX `agent_merge_primary_idx` ON `agent_record_merges` (`primaryUserId`,`mergedAt`);
