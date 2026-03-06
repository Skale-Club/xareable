-- My Social Autopilot - Supabase Database Setup
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor)

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  api_key text,
  is_admin boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.brands (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  company_name text not null,
  company_type text not null,
  color_1 text not null,
  color_2 text not null,
  color_3 text,
  color_4 text,
  mood text not null,
  logo_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  image_url text,
  thumbnail_url text,
  content_type text not null default 'image' check (content_type in ('image', 'video')),
  caption text,
  ai_prompt_used text,
  status text default 'generated',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.posts
  add column if not exists thumbnail_url text,
  add column if not exists content_type text not null default 'image';

create table if not exists public.post_versions (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  version_number integer not null,
  image_url text not null,
  edit_prompt text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, version_number)
);

create table if not exists public.landing_content (
  id uuid default gen_random_uuid() primary key,
  hero_headline text not null,
  hero_subtext text not null,
  hero_cta_text text not null,
  hero_secondary_cta_text text not null,
  hero_image_url text,
  features_title text not null,
  features_subtitle text not null,
  how_it_works_title text not null,
  how_it_works_subtitle text not null,
  testimonials_title text not null,
  testimonials_subtitle text not null,
  cta_title text not null,
  cta_subtitle text not null,
  cta_button_text text not null,
  cta_image_url text,
  logo_url text,
  alt_logo_url text,
  icon_url text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_by uuid references auth.users on delete set null
);

create table if not exists public.integration_settings (
  id uuid default gen_random_uuid() primary key,
  integration_type text not null unique,
  enabled boolean not null default false,
  api_key text,
  location_id text,
  custom_field_mappings jsonb not null default '{}'::jsonb,
  last_sync_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.integration_event_deliveries (
  id uuid default gen_random_uuid() primary key,
  integration_type text not null,
  event_type text not null,
  subject_id uuid references auth.users on delete cascade not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  delivered_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(integration_type, event_type, subject_id)
);

create table if not exists public.marketing_events (
  id uuid default gen_random_uuid() primary key,
  event_key text,
  event_name text not null,
  event_source text not null default 'app',
  user_id uuid references auth.users on delete set null,
  email text,
  event_payload jsonb not null default '{}'::jsonb,
  ga4_status text not null default 'queued',
  ga4_response jsonb,
  facebook_status text not null default 'queued',
  facebook_response jsonb,
  processed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists idx_marketing_events_event_key_unique
  on public.marketing_events (event_key)
  where event_key is not null;

alter table public.integration_settings
  add column if not exists enabled boolean not null default false,
  add column if not exists api_key text,
  add column if not exists location_id text,
  add column if not exists custom_field_mappings jsonb not null default '{}'::jsonb,
  add column if not exists last_sync_at timestamp with time zone,
  add column if not exists created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  add column if not exists updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

insert into public.integration_settings (integration_type, enabled, custom_field_mappings)
values ('ga4', false, '{}'::jsonb)
on conflict (integration_type) do nothing;

insert into public.integration_settings (integration_type, enabled, custom_field_mappings)
values ('facebook_dataset', false, '{}'::jsonb)
on conflict (integration_type) do nothing;

alter table public.landing_content
  add column if not exists hero_image_url text,
  add column if not exists cta_image_url text,
  add column if not exists logo_url text,
  add column if not exists alt_logo_url text,
  add column if not exists icon_url text;

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.posts enable row level security;
alter table public.post_versions enable row level security;
alter table public.landing_content enable row level security;
alter table public.integration_settings enable row level security;
alter table public.integration_event_deliveries enable row level security;
alter table public.marketing_events enable row level security;

create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

create policy "Users can view own brands" on public.brands for select using (auth.uid() = user_id);
create policy "Users can insert own brands" on public.brands for insert with check (auth.uid() = user_id);
create policy "Users can update own brands" on public.brands for update using (auth.uid() = user_id);
create policy "Users can delete own brands" on public.brands for delete using (auth.uid() = user_id);

create policy "Users can view own posts" on public.posts for select using (auth.uid() = user_id);
create policy "Users can insert own posts" on public.posts for insert with check (auth.uid() = user_id);
create policy "Users can delete own posts" on public.posts for delete using (auth.uid() = user_id);

create policy "Users can view versions of own posts" on public.post_versions for select
  using (exists (select 1 from public.posts where posts.id = post_versions.post_id and posts.user_id = auth.uid()));
create policy "Users can insert versions of own posts" on public.post_versions for insert
  with check (exists (select 1 from public.posts where posts.id = post_versions.post_id and posts.user_id = auth.uid()));
create policy "Users can delete versions of own posts" on public.post_versions for delete
  using (exists (select 1 from public.posts where posts.id = post_versions.post_id and posts.user_id = auth.uid()));

create policy "Anyone can view landing content" on public.landing_content for select using (true);
create policy "Admins can update landing content" on public.landing_content for update
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));
create policy "Admins can insert landing content" on public.landing_content for insert
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Admins can view integration settings" on public.integration_settings for select
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));
create policy "Admins can update integration settings" on public.integration_settings for update
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));
create policy "Admins can insert integration settings" on public.integration_settings for insert
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Admins can view marketing events" on public.marketing_events for select
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));
create policy "Admins can insert marketing events" on public.marketing_events for insert
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));
create policy "Admins can update marketing events" on public.marketing_events for update
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('user_assets', 'user_assets', true)
on conflict (id) do nothing;

create policy "Users can upload to own folder" on storage.objects for insert
  with check (bucket_id = 'user_assets' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own files" on storage.objects for update
  using (bucket_id = 'user_assets' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Anyone can view user assets" on storage.objects for select
  using (bucket_id = 'user_assets');
