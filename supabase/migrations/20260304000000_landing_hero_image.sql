-- Add hero image support to landing_content
alter table public.landing_content
  add column if not exists hero_image_url text;

comment on column public.landing_content.hero_image_url is 'Optional URL for the landing page hero image';
