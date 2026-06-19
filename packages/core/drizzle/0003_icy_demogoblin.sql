ALTER TABLE `shows` ADD `parts_text` text;--> statement-breakpoint
UPDATE `shows` SET `parts_text` = (
  SELECT group_concat(`title`, ' ') FROM `show_parts`
  WHERE `show_parts`.`show_id` = `shows`.`id` AND `title` IS NOT NULL AND `title` != ''
) WHERE EXISTS (
  SELECT 1 FROM `show_parts`
  WHERE `show_parts`.`show_id` = `shows`.`id` AND `title` IS NOT NULL AND `title` != ''
);
