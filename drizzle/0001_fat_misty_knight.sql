ALTER TABLE `agent_sessions` ADD `run_status` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `run_status_at` integer;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `last_viewed_at` integer;
