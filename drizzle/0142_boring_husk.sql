CREATE TABLE `orbit_financial_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`crmRef` varchar(100) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'GBP',
	`grossBookingValue` decimal(12,2),
	`totalNetCost` decimal(12,2),
	`netCostSubtotal` decimal(12,2),
	`netCostStatus` enum('complete','incomplete','unavailable') NOT NULL,
	`missingNetCostProducts` int NOT NULL DEFAULT 0,
	`grossMargin` decimal(12,2),
	`marginPct` decimal(7,3),
	`expectedCommission` decimal(12,2),
	`financialRevision` varchar(64) NOT NULL,
	`financialSnapshotAt` timestamp NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orbit_financial_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `orbit_financial_snapshots_booking_unique` UNIQUE(`bookingId`)
);
--> statement-breakpoint
CREATE INDEX `orbit_financial_snapshots_crm_ref_idx` ON `orbit_financial_snapshots` (`crmRef`);