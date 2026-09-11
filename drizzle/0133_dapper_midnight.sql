CREATE TABLE `public_agent_profile_changes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`agentId` int NOT NULL,
	`action` enum('draft_saved','submitted','published','changes_requested','hidden_manual','hidden_status','reactivation_review') NOT NULL,
	`actorUserId` int,
	`note` text,
	`snapshot` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `public_agent_profile_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `public_agent_profile_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`specialityTagId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `public_agent_profile_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `public_agent_profile_tags_profile_tag_unique` UNIQUE(`profileId`,`specialityTagId`)
);
--> statement-breakpoint
CREATE TABLE `public_agent_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(255),
	`businessName` varchar(255),
	`biography` text,
	`profilePhotoUrl` text,
	`profilePhotoKey` varchar(500),
	`listingTown` varchar(120),
	`townLatitude` decimal(10,7),
	`townLongitude` decimal(10,7),
	`enquiryDeliveryEmail` varchar(320),
	`websiteUrl` varchar(1000),
	`instagramUrl` varchar(1000),
	`tiktokUrl` varchar(1000),
	`facebookUrl` varchar(1000),
	`linkedinUrl` varchar(1000),
	`youtubeUrl` varchar(1000),
	`pinterestUrl` varchar(1000),
	`consentConfirmedAt` timestamp,
	`reviewStatus` enum('draft','in_review','changes_requested','published','hidden') NOT NULL DEFAULT 'draft',
	`isPublished` boolean NOT NULL DEFAULT false,
	`publicSlug` varchar(180),
	`submittedAt` timestamp,
	`reviewedById` int,
	`reviewedAt` timestamp,
	`reviewNote` text,
	`publishedAt` timestamp,
	`hiddenAt` timestamp,
	`hiddenReason` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_agent_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `public_agent_profiles_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `public_agent_profiles_publicSlug_unique` UNIQUE(`publicSlug`)
);
--> statement-breakpoint
CREATE TABLE `public_enquiries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`agentId` int NOT NULL,
	`customerName` varchar(255) NOT NULL,
	`customerEmail` varchar(320) NOT NULL,
	`customerPhone` varchar(40),
	`travelBrief` text NOT NULL,
	`consentConfirmedAt` timestamp NOT NULL,
	`ipHash` varchar(128) NOT NULL,
	`deliveryStatus` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`deliveryError` varchar(500),
	`deliveredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `public_enquiries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `public_partner_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(180) NOT NULL,
	`category` varchar(120),
	`summary` text,
	`logoUrl` text,
	`websiteUrl` varchar(1000),
	`isPublished` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_partner_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `public_partner_profiles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `public_speciality_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` enum('destination','travel_type') NOT NULL,
	`label` varchar(120) NOT NULL,
	`slug` varchar(140) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_speciality_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `public_speciality_tags_category_slug_unique` UNIQUE(`category`,`slug`)
);
--> statement-breakpoint
CREATE INDEX `public_agent_profile_changes_profile_idx` ON `public_agent_profile_changes` (`profileId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `public_agent_profile_tags_tag_idx` ON `public_agent_profile_tags` (`specialityTagId`);--> statement-breakpoint
CREATE INDEX `public_agent_profiles_published_idx` ON `public_agent_profiles` (`isPublished`);--> statement-breakpoint
CREATE INDEX `public_agent_profiles_town_idx` ON `public_agent_profiles` (`listingTown`);--> statement-breakpoint
CREATE INDEX `public_enquiries_profile_idx` ON `public_enquiries` (`profileId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `public_enquiries_rate_limit_idx` ON `public_enquiries` (`ipHash`,`createdAt`);--> statement-breakpoint
CREATE INDEX `public_speciality_tags_active_idx` ON `public_speciality_tags` (`isActive`,`category`);