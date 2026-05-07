CREATE TABLE `sso_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(128) NOT NULL,
	`userId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sso_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `sso_tokens_token_unique` UNIQUE(`token`)
);
