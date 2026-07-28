-- Phase 26 (POL-09): one overwritable thumbs-up/down vote per post.
-- Additive: nullable, no default, no backfill. NULL = no vote cast.
alter table public.posts add column if not exists feedback text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_feedback_check'
  ) then
    alter table public.posts
      add constraint posts_feedback_check
      check (feedback is null or feedback in ('up', 'down'));
  end if;
end $$;
