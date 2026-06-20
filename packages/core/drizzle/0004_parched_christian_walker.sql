CREATE TABLE `transcript_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transcript_id` integer NOT NULL,
	`show_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`start_sec` integer NOT NULL,
	`end_sec` integer NOT NULL,
	`text` text NOT NULL,
	`embed_model` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `transcripts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcript_chunks_transcript_idx` ON `transcript_chunks` (`transcript_id`);--> statement-breakpoint
CREATE INDEX `transcript_chunks_show_idx` ON `transcript_chunks` (`show_id`);--> statement-breakpoint
CREATE INDEX `transcript_chunks_embed_idx` ON `transcript_chunks` (`embed_model`);--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audio_file_id` integer NOT NULL,
	`show_id` integer NOT NULL,
	`lang` text,
	`model` text NOT NULL,
	`text` text NOT NULL,
	`segments_json` text,
	`duration_sec` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`audio_file_id`) REFERENCES `audio_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcripts_audio_file_id_unique` ON `transcripts` (`audio_file_id`);--> statement-breakpoint
CREATE INDEX `transcripts_show_idx` ON `transcripts` (`show_id`);