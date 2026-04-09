CREATE TABLE IF NOT EXISTS `visits` (
	`id` integer PRIMARY KEY NOT NULL,
	`post_id` integer NOT NULL,
	`ip` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
