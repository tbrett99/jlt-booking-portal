CREATE TABLE `staff_handbook_import_sources` (
	`externalReference` varchar(80) NOT NULL,
	`articleId` int NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`importedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_handbook_import_sources_externalReference` PRIMARY KEY(`externalReference`),
	CONSTRAINT `sh_import_article_uq` UNIQUE(`articleId`)
);
--> statement-breakpoint
ALTER TABLE `staff_handbook_import_sources` ADD CONSTRAINT `sh_import_article_fk` FOREIGN KEY (`articleId`) REFERENCES `staff_handbook_articles`(`id`) ON DELETE restrict ON UPDATE no action;