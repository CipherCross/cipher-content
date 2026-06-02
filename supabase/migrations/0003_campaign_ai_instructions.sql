-- Per-campaign AI instructions: a free-text field to steer the tone and voice
-- of generated posts (and themes), separate from the human-facing description.
alter table public.campaigns
  add column ai_instructions text not null default '';
