CREATE TABLE `campaign_sends` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`recipientEmail` varchar(320) NOT NULL,
	`recipientName` varchar(255),
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` varchar(500),
	`sentAt` timestamp,
	CONSTRAINT `campaign_sends_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `commission_remittance_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`remittanceId` int NOT NULL,
	`agentId` int,
	`agentCode` varchar(50),
	`agentName` varchar(255),
	`amount` decimal(10,2) NOT NULL,
	`bookingRef` varchar(100),
	`description` varchar(500),
	`notificationSentAt` timestamp,
	CONSTRAINT `commission_remittance_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `commission_remittances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uploadedById` int NOT NULL,
	`filename` varchar(255) NOT NULL,
	`csvUrl` text,
	`csvKey` varchar(500),
	`periodLabel` varchar(100),
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commission_remittances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contract_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`pdfUrl` text NOT NULL,
	`pdfKey` varchar(500) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contract_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`bodyHtml` mediumtext NOT NULL,
	`segmentType` enum('all_agents','all_prospects','all_contacts','won_prospects','custom') NOT NULL DEFAULT 'all_contacts',
	`status` enum('draft','sending','sent') NOT NULL DEFAULT 'draft',
	`sentAt` timestamp,
	`sentCount` int NOT NULL DEFAULT 0,
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stripeJoiningFeeUrl` text,
	`businessClassDay1Url` text,
	`businessClassDay15Url` text,
	`businessClassDay28Url` text,
	`firstClassDay1Url` text,
	`firstClassDay15Url` text,
	`firstClassDay28Url` text,
	`updatedById` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prospect_ar_forms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`whyInterested` text,
	`isSelfEmployed` varchar(10),
	`hasTravelExperience` varchar(10),
	`travelExperienceDetails` text,
	`currentJob` varchar(255),
	`businessGoal12Months` varchar(100),
	`travelSpecialisation` text,
	`weeklyHours` varchar(50),
	`hasHomeSupport` varchar(20),
	`investmentReadiness` varchar(100),
	`understandsSelfEmployed` varchar(100),
	`biggestHesitation` text,
	`techConfidence` varchar(100),
	`financialReadiness` varchar(100),
	`twoYearVision` text,
	`hearAboutUs` varchar(255),
	`hearAboutUsDetails` varchar(255),
	`lookingAtOtherAgencies` varchar(10),
	`otherAgenciesDetails` varchar(255),
	`confirmationAccepted` boolean NOT NULL DEFAULT false,
	`reviewStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewNotes` text,
	`reviewedById` int,
	`reviewedAt` timestamp,
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prospect_ar_forms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prospect_contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`templateId` int,
	`signingToken` varchar(128),
	`signingTokenExpiresAt` timestamp,
	`signerName` varchar(255),
	`signerAddress` text,
	`signatureDataUrl` text,
	`signedPdfUrl` text,
	`signedPdfKey` varchar(500),
	`sentAt` timestamp,
	`signedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prospect_contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `prospect_contracts_signingToken_unique` UNIQUE(`signingToken`)
);
--> statement-breakpoint
CREATE TABLE `prospect_pipeline_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`fromStage` varchar(100),
	`toStage` varchar(100) NOT NULL,
	`movedById` int,
	`note` varchar(500),
	`movedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prospect_pipeline_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prospect_supplier_logins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`supplierName` varchar(255) NOT NULL,
	`username` varchar(255),
	`passwordEncrypted` varchar(512),
	`loginUrl` varchar(500),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prospect_supplier_logins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prospect_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prospectId` int NOT NULL,
	`tag` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prospect_tags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prospects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(30),
	`marketingConsent` boolean NOT NULL DEFAULT false,
	`stage` enum('New Enquiry','AR Submitted','AR Approved','Discovery Call Booked','Approved','Rejected','Lost','Won') NOT NULL DEFAULT 'New Enquiry',
	`uniqueAgentId` varchar(20),
	`personalEmail` varchar(320),
	`jltEmail` varchar(320),
	`mobile` varchar(30),
	`addressLine1` varchar(255),
	`addressLine2` varchar(255),
	`city` varchar(100),
	`postcode` varchar(20),
	`ukRegion` varchar(100),
	`idDocUrl` text,
	`idDocKey` varchar(500),
	`proofOfAddressUrl` text,
	`proofOfAddressKey` varchar(500),
	`bankAccountName` varchar(255),
	`bankSortCode` varchar(512),
	`bankAccountNumber` varchar(512),
	`wonPortalAccess` boolean NOT NULL DEFAULT false,
	`fullPortalAccess` boolean NOT NULL DEFAULT false,
	`linkedUserId` int,
	`adminNotes` text,
	`source` varchar(100) DEFAULT 'enquiry_form',
	`createdById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prospects_id` PRIMARY KEY(`id`),
	CONSTRAINT `prospects_uniqueAgentId_unique` UNIQUE(`uniqueAgentId`)
);
