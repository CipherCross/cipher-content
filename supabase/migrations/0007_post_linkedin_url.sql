-- Link to the live LinkedIn post (set on import / after posting), so the SDR
-- can jump straight from the Stats grid to the post when refreshing numbers.
alter table public.posts add column linkedin_url text;
