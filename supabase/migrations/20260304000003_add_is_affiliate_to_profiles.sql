-- Add is_affiliate column to profiles table
alter table public.profiles
add column if not exists is_affiliate boolean not null default false;
