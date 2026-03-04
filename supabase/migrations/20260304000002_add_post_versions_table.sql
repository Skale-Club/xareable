-- Add post_versions table for edited post history

create table if not exists public.post_versions (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  version_number integer not null,
  image_url text not null,
  edit_prompt text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists post_versions_post_id_version_number_key
  on public.post_versions (post_id, version_number);

alter table public.post_versions enable row level security;

drop policy if exists "Users can view versions of own posts" on public.post_versions;
create policy "Users can view versions of own posts" on public.post_versions for select
  using (
    exists (
      select 1
      from public.posts
      where posts.id = post_versions.post_id and posts.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert versions of own posts" on public.post_versions;
create policy "Users can insert versions of own posts" on public.post_versions for insert
  with check (
    exists (
      select 1
      from public.posts
      where posts.id = post_versions.post_id and posts.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete versions of own posts" on public.post_versions;
create policy "Users can delete versions of own posts" on public.post_versions for delete
  using (
    exists (
      select 1
      from public.posts
      where posts.id = post_versions.post_id and posts.user_id = auth.uid()
    )
  );
