ALTER TABLE `shows` ADD `plays` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `displays` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `shows_created_at_idx` ON `shows` (`created_at`);--> statement-breakpoint
CREATE INDEX `shows_plays_idx` ON `shows` (`plays`);