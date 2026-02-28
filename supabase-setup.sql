-- My Social Autopilot - Supabase Database Setup
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor)

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  api_key text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.brands (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  company_name text not null,
  company_type text not null,
  color_1 text not null,
  color_2 text not null,
  color_3 text not null,
  mood text not null,
  logo_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  image_url text,
  caption text,
  ai_prompt_used text,
  status text default 'generated',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.posts enable row level security;

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
