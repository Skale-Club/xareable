create table if not exists public.translations (
  id uuid default gen_random_uuid() primary key,
  source_text text not null,
  source_language text not null default 'en',
  target_language text not null,
  translated_text text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists translations_source_text_target_language_key
  on public.translations (source_text, target_language);

alter table public.translations enable row level security;
