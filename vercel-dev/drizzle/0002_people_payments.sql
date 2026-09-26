CREATE TABLE `pp_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`due_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`applied_on` text NOT NULL,
	`reversed_on` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`reversed_at` text,
	`reversed_by` text,
	FOREIGN KEY (`payment_id`) REFERENCES `pp_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`due_id`) REFERENCES `pp_dues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pp_allocation_amount" CHECK(typeof("pp_allocations"."amount_paise") = 'integer' AND "pp_allocations"."amount_paise" BETWEEN 1 AND 1000000000000),
	CONSTRAINT "pp_allocation_dates" CHECK("pp_allocations"."reversed_on" IS NULL OR "pp_allocations"."reversed_on" >= "pp_allocations"."applied_on")
);
--> statement-breakpoint
CREATE INDEX `pp_allocation_payment` ON `pp_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `pp_allocation_due` ON `pp_allocations` (`due_id`);--> statement-breakpoint
CREATE TABLE `pp_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pp_audit_entity` ON `pp_audit` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `pp_dues` (
	`id` text PRIMARY KEY NOT NULL,
	`issued_on` text NOT NULL,
	`due_on` text NOT NULL,
	`person_id` text NOT NULL,
	`project` text NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `pp_people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pp_due_amount" CHECK(typeof("pp_dues"."amount_paise") = 'integer' AND "pp_dues"."amount_paise" BETWEEN 1 AND 1000000000000),
	CONSTRAINT "pp_due_dates" CHECK("pp_dues"."due_on" >= "pp_dues"."issued_on"),
	CONSTRAINT "pp_due_direction" CHECK("pp_dues"."direction" IN ('in','out')),
	CONSTRAINT "pp_due_status" CHECK("pp_dues"."status" IN ('open','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `pp_due_person_date` ON `pp_dues` (`person_id`,`due_on`);--> statement-breakpoint
CREATE INDEX `pp_due_project_date` ON `pp_dues` (`project`,`due_on`);--> statement-breakpoint
CREATE TABLE `pp_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_date` text NOT NULL,
	`person_id` text NOT NULL,
	`project` text NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`reference_key` text,
	`notes` text DEFAULT '' NOT NULL,
	`refund_of` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `pp_people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_of`) REFERENCES `pp_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pp_payment_amount" CHECK(typeof("pp_payments"."amount_paise") = 'integer' AND "pp_payments"."amount_paise" BETWEEN 1 AND 1000000000000),
	CONSTRAINT "pp_payment_direction" CHECK("pp_payments"."direction" IN ('in','out')),
	CONSTRAINT "pp_payment_status" CHECK("pp_payments"."status" IN ('pending','completed','void'))
);
--> statement-breakpoint
CREATE INDEX `pp_payment_person_date` ON `pp_payments` (`person_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `pp_payment_project_date` ON `pp_payments` (`project`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `pp_payment_refund` ON `pp_payments` (`refund_of`);--> statement-breakpoint
CREATE UNIQUE INDEX `pp_payment_reference` ON `pp_payments` (`mode`,`direction`,`reference_key`) WHERE "pp_payments"."status" != 'void';--> statement-breakpoint
CREATE TABLE `pp_people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`code_key` text,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`roles_json` text NOT NULL,
	`projects_json` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pp_person_active" CHECK("pp_people"."active" IN (0,1)),
	CONSTRAINT "pp_person_lists" CHECK(json_valid("pp_people"."roles_json") AND json_valid("pp_people"."projects_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pp_person_code` ON `pp_people` (`code_key`);--> statement-breakpoint
CREATE INDEX `pp_person_name` ON `pp_people` (`name_key`);--> statement-breakpoint
CREATE TABLE `pp_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`response_json` text NOT NULL,
	`status_code` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TRIGGER pp_people_no_delete BEFORE DELETE ON pp_people BEGIN SELECT RAISE(ABORT, 'Financial history cannot be deleted'); END;

--> statement-breakpoint
CREATE TRIGGER pp_payments_no_delete BEFORE DELETE ON pp_payments BEGIN SELECT RAISE(ABORT, 'Financial history cannot be deleted'); END;

--> statement-breakpoint
CREATE TRIGGER pp_dues_no_delete BEFORE DELETE ON pp_dues BEGIN SELECT RAISE(ABORT, 'Financial history cannot be deleted'); END;

--> statement-breakpoint
CREATE TRIGGER pp_allocations_no_delete BEFORE DELETE ON pp_allocations BEGIN SELECT RAISE(ABORT, 'Financial history cannot be deleted'); END;

--> statement-breakpoint
CREATE TRIGGER pp_audit_no_delete BEFORE DELETE ON pp_audit BEGIN SELECT RAISE(ABORT, 'Financial history cannot be deleted'); END;

--> statement-breakpoint
CREATE TRIGGER pp_requests_no_delete BEFORE DELETE ON pp_requests BEGIN SELECT RAISE(ABORT, 'Financial history cannot be deleted'); END;

--> statement-breakpoint
CREATE TRIGGER pp_audit_no_update BEFORE UPDATE ON pp_audit BEGIN SELECT RAISE(ABORT, 'Audit and request history is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER pp_requests_no_update BEFORE UPDATE ON pp_requests BEGIN SELECT RAISE(ABORT, 'Audit and request history is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER pp_allocation_reversal_only BEFORE UPDATE ON pp_allocations WHEN OLD.reversed_on IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.payment_id IS NOT OLD.payment_id OR NEW.due_id IS NOT OLD.due_id OR NEW.amount_paise IS NOT OLD.amount_paise OR NEW.applied_on IS NOT OLD.applied_on OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by OR NEW.reversed_on IS NULL OR NEW.reversed_at IS NULL OR NEW.reversed_by IS NULL BEGIN SELECT RAISE(ABORT, 'Applications can only be reversed once'); END;
