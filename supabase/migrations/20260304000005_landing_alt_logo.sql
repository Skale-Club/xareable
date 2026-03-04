-- Add alternative landing logo support to landing_content
alter table public.landing_content
  add column if not exists alt_logo_url text;

comment on column public.landing_content.alt_logo_url is 'Optional URL for the alternate landing logo used in hover states';
