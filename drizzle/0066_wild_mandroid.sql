CREATE TABLE `booking_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`uploadedById` int NOT NULL,
	`uploadedByName` varchar(128),
	`docType` enum('invoice','atol','other') NOT NULL DEFAULT 'other',
	`displayName` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`mimeType` varchar(128),
	`fileSize` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_documents_id` PRIMARY KEY(`id`)
);
