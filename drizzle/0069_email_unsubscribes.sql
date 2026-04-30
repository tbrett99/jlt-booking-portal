CREATE TABLE `email_unsubscribes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`token` varchar(64) NOT NULL,
	`prospectId` int,
	`unsubscribedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_unsubscribes_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_unsubscribes_token_unique` UNIQUE(`token`)
);
