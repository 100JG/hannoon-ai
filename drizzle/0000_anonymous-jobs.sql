CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`ip_hash` text NOT NULL,
	`request_id` text,
	`source_hash` text NOT NULL,
	`cap_hash` text NOT NULL,
	`state` text NOT NULL,
	`private_state` text,
	`result_json` text,
	`error` text,
	`quota_day` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`reserved_calls` integer DEFAULT 6 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`last_stage` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`session_limit` integer NOT NULL,
	`ip_limit` integer NOT NULL,
	`global_limit` integer NOT NULL,
	`api_limit` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_request` ON `jobs` (`owner`,`request_id`);--> statement-breakpoint
CREATE INDEX `jobs_expiry` ON `jobs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `jobs_active` ON `jobs` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `quotas` (
	`day` text NOT NULL,
	`scope` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_day_scope` ON `quotas` (`day`,`scope`);