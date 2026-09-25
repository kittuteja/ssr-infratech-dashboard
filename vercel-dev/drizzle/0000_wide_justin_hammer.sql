CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`action` text NOT NULL,
	`note` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`recorded_at` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_material_recorded` ON `audit` (`material_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`brand` text NOT NULL,
	`supplier` text DEFAULT '' NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`project` text NOT NULL,
	`unit` text NOT NULL,
	`quantity100` integer NOT NULL,
	`minimum100` integer NOT NULL,
	`price100` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "material_nonnegative" CHECK("materials"."quantity100" >= 0 AND "materials"."minimum100" > 0 AND "materials"."price100" >= 0)
);
--> statement-breakpoint
CREATE TABLE `movements` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity100` integer NOT NULL,
	`balance100` integer NOT NULL,
	`note` text NOT NULL,
	`party` text DEFAULT '' NOT NULL,
	`batch` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "movement_positive" CHECK("movements"."quantity100" > 0),
	CONSTRAINT "movement_type" CHECK("movements"."type" IN ('received','issued'))
);
--> statement-breakpoint
CREATE INDEX `idx_movements_material_recorded` ON `movements` (`material_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL
);
