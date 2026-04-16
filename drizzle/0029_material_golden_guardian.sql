CREATE TABLE `agent_crm_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`uniqueAgentId` varchar(20),
	`jltEmail` varchar(320),
	`personalEmail` varchar(320),
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
	`adminNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_crm_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_crm_profiles_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `agent_crm_profiles_uniqueAgentId_unique` UNIQUE(`uniqueAgentId`)
);
--> statement-breakpoint
CREATE TABLE `agent_supplier_logins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`supplierName` varchar(255) NOT NULL,
	`loginUrl` varchar(1000),
	`username` varchar(255),
	`passwordEncrypted` varchar(512),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_supplier_logins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tag` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_tags_id` PRIMARY KEY(`id`)
);
