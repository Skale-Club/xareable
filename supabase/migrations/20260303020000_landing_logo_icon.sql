-- Create the landing_content settings table used by the admin landing editor.
-- This is distinct from the legacy landing_page_content block table.
create table if not exists public.landing_content (
  id uuid default gen_random_uuid() primary key,
  hero_headline text not null default 'Create and Post Stunning Social Posts in Seconds',
  hero_subtext text not null default 'Generate brand-consistent social media images and captions with AI. Just type your message, pick a style, and let the AI do the rest.',
  hero_cta_text text not null default 'Start Creating for Free',
  hero_secondary_cta_text text not null default 'See How It Works',
  features_title text not null default 'Everything You Need to Automate Content',
  features_subtitle text not null default 'From brand setup to publish-ready graphics, every feature is designed to save you time and keep your content on-brand.',
  how_it_works_title text not null default 'How It Works',
  how_it_works_subtitle text not null default 'Three simple steps from idea to publish-ready social media content.',
  testimonials_title text not null default 'Loved by Marketers',
  testimonials_subtitle text not null default 'See what our users are saying about their experience.',
  cta_title text not null default 'Ready to Automate Your Content?',
  cta_subtitle text not null default 'Join thousands of marketers who create branded social media content in seconds, not hours.',
  cta_button_text text not null default 'Get Started Free',
  logo_url text,
  icon_url text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_by uuid references auth.users on delete set null
);

alter table public.landing_content
  add column if not exists logo_url text,
  add column if not exists icon_url text;

alter table public.landing_content enable row level security;

drop policy if exists "Anyone can view landing content" on public.landing_content;
create policy "Anyone can view landing content" on public.landing_content
  for select
  using (true);

drop policy if exists "Admins can update landing content" on public.landing_content;
create policy "Admins can update landing content" on public.landing_content
  for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

drop policy if exists "Admins can insert landing content" on public.landing_content;
create policy "Admins can insert landing content" on public.landing_content
  for insert
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

comment on column public.landing_content.logo_url is 'URL to the landing page logo (appears in header/footer)';
comment on column public.landing_content.icon_url is 'URL to the site favicon/icon';
