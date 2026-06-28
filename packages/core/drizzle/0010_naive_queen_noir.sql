CREATE TABLE `show_transcript_embeddings` (
	`show_id` integer PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`dims` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
