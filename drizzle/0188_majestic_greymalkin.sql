CREATE TABLE `management_hq_datasets` (
	`datasetId` varchar(120) NOT NULL,
	`mode` enum('sample','live') NOT NULL,
	`ownerUserId` int NOT NULL,
	`stateVersion` int NOT NULL,
	`state` json NOT NULL,
	`updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `management_hq_datasets_datasetId` PRIMARY KEY(`datasetId`)
);
--> statement-breakpoint
CREATE INDEX `management_hq_owner_idx` ON `management_hq_datasets` (`ownerUserId`,`mode`);