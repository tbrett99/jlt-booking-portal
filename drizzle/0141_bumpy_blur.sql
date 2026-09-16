ALTER TABLE `commission_claims` ADD `bookingCompleteConfirmed` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `bookingCompleteConfirmedAt` timestamp;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `hasKeyTransferSupplier` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `commission_claims` ADD `keyTransferSupplierDeclaredAt` timestamp;