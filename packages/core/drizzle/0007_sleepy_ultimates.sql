CREATE TABLE `category_group_programmes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`programme` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `category_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_group_programmes_unique` ON `category_group_programmes` (`group_id`,`programme`);--> statement-breakpoint
CREATE INDEX `category_group_programmes_group_pos_idx` ON `category_group_programmes` (`group_id`,`position`);--> statement-breakpoint
CREATE TABLE `category_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`thumbnail_cid` text,
	`thumbnail_url` text,
	`published` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_groups_slug_unique` ON `category_groups` (`slug`);--> statement-breakpoint
CREATE INDEX `category_groups_published_pos_idx` ON `category_groups` (`published`,`position`);--> statement-breakpoint
CREATE INDEX `shows_show_name_idx` ON `shows` (`show_name`);