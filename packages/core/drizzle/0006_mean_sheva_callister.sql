CREATE TABLE `selection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`selection_id` integer NOT NULL,
	`show_id` integer NOT NULL,
	`part_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`selection_id`) REFERENCES `selections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `show_parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `selection_items_unique` ON `selection_items` (`selection_id`,`show_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `selection_items_selection_pos_idx` ON `selection_items` (`selection_id`,`position`);--> statement-breakpoint
CREATE TABLE `selections` (
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
CREATE UNIQUE INDEX `selections_slug_unique` ON `selections` (`slug`);--> statement-breakpoint
CREATE INDEX `selections_published_pos_idx` ON `selections` (`published`,`position`);