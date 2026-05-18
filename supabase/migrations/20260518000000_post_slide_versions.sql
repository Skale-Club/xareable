-- Phase 13: per-slide edit history
-- Keyed on (post_slide_id, version_number); distinct from post_versions (global per post_id).
-- Applied via Supabase dashboard SQL editor — NOT via Drizzle (see STATE.md Phase 11 decision).

create table if not exists public.post_slide_versions (
  id uuid default gen_random_uuid() primary key,
  post_slide_id uuid references public.post_slides on delete cascade not null,
  version_number integer not null,
  image_url text not null,
  thumbnail_url text,
  edit_prompt text,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

create unique index if not exists post_slide_versions_slide_version_unique
  on public.post_slide_versions (post_slide_id, version_number);

alter table public.post_slide_versions enable row level security;

drop policy if exists "post_slide_versions_select_own" on public.post_slide_versions;
create policy "post_slide_versions_select_own" on public.post_slide_versions
  for select using (
    exists (
      select 1 from public.post_slides ps
      join public.posts p on p.id = ps.post_id
      where ps.id = post_slide_versions.post_slide_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "post_slide_versions_insert_own" on public.post_slide_versions;
create policy "post_slide_versions_insert_own" on public.post_slide_versions
  for insert with check (
    exists (
      select 1 from public.post_slides ps
      join public.posts p on p.id = ps.post_id
      where ps.id = post_slide_versions.post_slide_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "post_slide_versions_delete_own" on public.post_slide_versions;
create policy "post_slide_versions_delete_own" on public.post_slide_versions
  for delete using (
    exists (
      select 1 from public.post_slides ps
      join public.posts p on p.id = ps.post_id
      where ps.id = post_slide_versions.post_slide_id and p.user_id = auth.uid()
    )
  );
