-- Add quick_remake_count column to user_credits for limiting free users

alter table public.user_credits
  add column if not exists quick_remake_count integer not null default 0;

comment on column public.user_credits.quick_remake_count is 'Number of quick remakes used by free users (lifetime, max 2)';