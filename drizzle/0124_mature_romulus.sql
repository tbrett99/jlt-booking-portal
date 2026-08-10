CREATE TABLE `user_deletions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deletedUserId` int NOT NULL,
	`deletedUserEmail` varchar(320) NOT NULL,
	`deletedUserName` varchar(255),
	`deletedUserRole` varchar(50),
	`deletedByUserId` int,
	`deletedByEmail` varchar(320),
	`deletedByName` varchar(255),
	`deletedFrom` varchar(100),
	`deletedAt` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	CONSTRAINT `user_deletions_id` PRIMARY KEY(`id`)
);
