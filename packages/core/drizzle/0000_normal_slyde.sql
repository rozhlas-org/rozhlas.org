CREATE TABLE `artworks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`ipfs_cid` text,
	`source_url` text,
	`width` integer,
	`height` integer,
	`role` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artworks_show_idx` ON `artworks` (`show_id`);--> statement-breakpoint
CREATE TABLE `audio_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`part_id` integer,
	`ipfs_cid` text,
	`container` text,
	`codec` text,
	`manifest_url` text,
	`manifest_kind` text,
	`bitrate` integer,
	`size_bytes` integer,
	`duration_sec` integer,
	`streamable` integer DEFAULT false NOT NULL,
	`checksum` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `show_parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audio_files_show_idx` ON `audio_files` (`show_id`);--> statement-breakpoint
CREATE INDEX `audio_files_cid_idx` ON `audio_files` (`ipfs_cid`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`title` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_key_unique` ON `categories` (`key`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_name_unique` ON `people` (`name`);--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`discovered` integer DEFAULT 0 NOT NULL,
	`succeeded` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `show_categories` (
	`show_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`show_id`, `category_id`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `show_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`title` text,
	`duration_sec` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `show_parts_unique` ON `show_parts` (`show_id`,`idx`);--> statement-breakpoint
CREATE TABLE `show_people` (
	`show_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`role` text,
	PRIMARY KEY(`show_id`, `person_id`, `role`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `show_tags` (
	`show_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`show_id`, `tag_id`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`source_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`show_name` text,
	`published_at` integer,
	`duration_sec` integer,
	`language` text DEFAULT 'cs',
	`raw_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_slug_unique` ON `shows` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `shows_source_unique` ON `shows` (`source_key`,`source_id`);--> statement-breakpoint
CREATE INDEX `shows_published_at_idx` ON `shows` (`published_at`);--> statement-breakpoint
CREATE INDEX `shows_source_key_idx` ON `shows` (`source_key`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`title` text,
	`enabled` integer DEFAULT true NOT NULL,
	`schedule` text,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_key_unique` ON `sources` (`key`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);