CREATE TABLE `orbit_financial_sync_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`financialRevision` varchar(64) NOT NULL,
	`outcome` enum('applied','held_for_claim_review') NOT NULL,
	`reason` varchar(500),
	`grossBookingValue` decimal(12,2),
	`marginPct` decimal(7,3),
	`expectedCommission` decimal(12,2),
	`snapshotAt` timestamp NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orbit_financial_sync_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `orbit_financial_sync_event_revision_unique` UNIQUE(`bookingId`,`financialRevision`)
);
--> statement-breakpoint
CREATE INDEX `orbit_financial_sync_event_booking_received_idx` ON `orbit_financial_sync_events` (`bookingId`,`receivedAt`);