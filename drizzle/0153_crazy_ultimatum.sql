ALTER TABLE `commission_claims` ADD `agentPaymentReceivedAt` timestamp;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `agentPaymentReceivedById` int;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD CONSTRAINT `commission_claims_bookingId_unique` UNIQUE(`bookingId`);
