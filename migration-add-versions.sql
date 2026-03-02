-- Migration: Add post_versions table
-- Run this in your Supabase SQL Editor if you already have the database set up

-- Create post_versions table if it doesn't exist
create table if not exists public.post_versions (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  version_number integer not null,
  image_url text not null,
  edit_prompt text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, version_number)
);

-- Enable RLS
alter table public.post_versions enable row level security;

-- Create policies
create policy "Users can view versions of own posts" on public.post_versions for select
  using (exists (select 1 from public.posts where posts.id = post_versions.post_id and posts.user_id = auth.uid()));

create policy "Users can insert versions of own posts" on public.post_versions for insert
  with check (exists (select 1 from public.posts where posts.id = post_versions.post_id and posts.user_id = auth.uid()));

create policy "Users can delete versions of own posts" on public.post_versions for delete
  using (exists (select 1 from public.posts where posts.id = post_versions.post_id and posts.user_id = auth.uid()));

-- Done! Your database now supports post versioning.
