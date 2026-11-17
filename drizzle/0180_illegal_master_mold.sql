CREATE TABLE IF NOT EXISTS `business_staff_memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`staffUserId` int NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`permissions` json NOT NULL,
	`orbitRequested` boolean NOT NULL DEFAULT false,
	`revision` int NOT NULL DEFAULT 1,
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`revokedAt` timestamp,
	CONSTRAINT `business_staff_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `business_staff_member_user_uq` UNIQUE(`staffUserId`),
	CONSTRAINT `business_staff_owner_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action,
	CONSTRAINT `business_staff_user_fk` FOREIGN KEY (`staffUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action,
	CONSTRAINT `business_staff_creator_fk` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action,
	INDEX `business_staff_owner_idx` (`ownerUserId`)
);

CREATE TABLE IF NOT EXISTS `business_staff_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`membershipId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`action` varchar(40) NOT NULL,
	`reason` varchar(1000) NOT NULL,
	`beforeState` json,
	`afterState` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `business_staff_audit_id` PRIMARY KEY(`id`),
	CONSTRAINT `business_staff_audit_member_fk` FOREIGN KEY (`membershipId`) REFERENCES `business_staff_memberships`(`id`) ON DELETE no action ON UPDATE no action,
	CONSTRAINT `business_staff_audit_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action,
	INDEX `business_staff_audit_member_idx` (`membershipId`)
);

CREATE TABLE IF NOT EXISTS `business_staff_booking_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`ownerUserId` int NOT NULL,
	`authorUserId` int NOT NULL,
	`membershipId` int,
	`text` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `business_staff_booking_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `business_staff_note_booking_fk` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE no action ON UPDATE no action,
	CONSTRAINT `business_staff_note_owner_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action,
	CONSTRAINT `business_staff_note_author_fk` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action,
	CONSTRAINT `business_staff_note_member_fk` FOREIGN KEY (`membershipId`) REFERENCES `business_staff_memberships`(`id`) ON DELETE no action ON UPDATE no action,
	INDEX `business_staff_notes_booking_idx` (`bookingId`,`ownerUserId`)
);
